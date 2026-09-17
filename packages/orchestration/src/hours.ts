import {
  DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES,
  type RestaurantCandidate,
  type RestaurantHoursAssessment
} from "@rc/protocol";
import type { Event } from "@rc/domain";
import type { Principal } from "@rc/auth";
import {
  EVALUATION_CANDIDATE_LIMIT,
  assessRestaurantHours,
  candidateAsRestaurant,
  hasStructuredHours,
  hoursAreFresh,
  type RestaurantSearchTool
} from "@rc/tools";
import { mergeRestaurantMedia } from "./candidate-media.ts";

const HOURS_ENRICH_LIMIT = 32;
const HOURS_ENRICH_CONCURRENCY = 4;

export interface HoursFilterResult {
  kept: RestaurantCandidate[];
  eliminated: Array<{ candidate: RestaurantCandidate; assessment: RestaurantHoursAssessment }>;
  metrics: {
    restaurant_hours_requested: number;
    restaurant_hours_cache_hit: number;
    restaurant_hours_cache_miss: number;
    restaurant_hours_suitable: number;
    restaurant_hours_closed: number;
    restaurant_hours_closes_too_soon: number;
    restaurant_hours_unknown: number;
    restaurant_hours_provider_failure: number;
  };
}

function emptyMetrics(): HoursFilterResult["metrics"] {
  return {
    restaurant_hours_requested: 0,
    restaurant_hours_cache_hit: 0,
    restaurant_hours_cache_miss: 0,
    restaurant_hours_suitable: 0,
    restaurant_hours_closed: 0,
    restaurant_hours_closes_too_soon: 0,
    restaurant_hours_unknown: 0,
    restaurant_hours_provider_failure: 0
  };
}

function tally(metrics: HoursFilterResult["metrics"], status: RestaurantHoursAssessment["status"]): void {
  if (status === "suitable") metrics.restaurant_hours_suitable += 1;
  else if (status === "closed") metrics.restaurant_hours_closed += 1;
  else if (status === "closes-too-soon") metrics.restaurant_hours_closes_too_soon += 1;
  else metrics.restaurant_hours_unknown += 1;
}

function slimOpeningHours(
  hours: RestaurantCandidate["openingHours"]
): RestaurantCandidate["openingHours"] {
  if (!hours) return undefined;
  return {
    timeZone: hours.timeZone,
    weekdayText: hours.weekdayText,
    retrievedAt: hours.retrievedAt,
    sourceType: hours.sourceType
  };
}

export function eventHoursContext(event: Event): {
  eventDateTime?: string;
  minimumOpenAfterEventMinutes: number;
} {
  return {
    eventDateTime: event.date,
    minimumOpenAfterEventMinutes:
      event.restaurantSearchPolicy?.minimumOpenAfterEventMinutes ??
      DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES
  };
}

export async function retainCandidatesByHours(input: {
  candidates: RestaurantCandidate[];
  event: Event;
  restaurants: RestaurantSearchTool;
  principal: Principal;
  previous?: RestaurantCandidate[];
}): Promise<HoursFilterResult> {
  const metrics = emptyMetrics();
  const { eventDateTime, minimumOpenAfterEventMinutes } = eventHoursContext(input.event);
  if (!eventDateTime) {
    const kept = input.candidates.slice(0, EVALUATION_CANDIDATE_LIMIT).map((candidate) => ({
      ...candidate,
      hoursAssessment: assessRestaurantHours(
        candidateAsRestaurant(candidate),
        undefined,
        minimumOpenAfterEventMinutes
      )
    }));
    metrics.restaurant_hours_unknown = kept.length;
    return { kept, eliminated: [], metrics };
  }

  const previous = new Map((input.previous ?? []).map((item) => [item.id, item]));
  const kept: RestaurantCandidate[] = [];
  const eliminated: HoursFilterResult["eliminated"] = [];
  const pool = input.candidates.slice(0, HOURS_ENRICH_LIMIT);
  let cursor = 0;

  const assess = async (candidate: RestaurantCandidate): Promise<void> => {
    let next = mergeRestaurantMedia(candidate, previous.get(candidate.id));
    let restaurant = candidateAsRestaurant(next);
    try {
      const details = input.restaurants.enrichHours
        ? await input.restaurants.enrichHours(next.id, input.principal)
        : await input.restaurants.getRestaurant(next.id, input.principal);
      next = mergeRestaurantMedia(details, next);
      restaurant = candidateAsRestaurant(next);
      if ("hoursCacheHit" in details && details.hoursCacheHit) {
        metrics.restaurant_hours_cache_hit += 1;
      } else {
        metrics.restaurant_hours_requested += 1;
        metrics.restaurant_hours_cache_miss += 1;
      }
    } catch {
      if (hasStructuredHours(restaurant) && hoursAreFresh(restaurant)) {
        metrics.restaurant_hours_cache_hit += 1;
      } else {
        metrics.restaurant_hours_requested += 1;
        metrics.restaurant_hours_cache_miss += 1;
        metrics.restaurant_hours_provider_failure += 1;
      }
    }

    const assessment = assessRestaurantHours(restaurant, eventDateTime, minimumOpenAfterEventMinutes);
    next = {
      ...next,
      openingHours: slimOpeningHours(next.openingHours ?? restaurant.openingHours),
      hoursAssessment: assessment,
      hoursWeekdayText: next.hoursWeekdayText ?? restaurant.openingHours?.weekdayText,
      hours: next.hours ?? restaurant.openingHours?.weekdayText?.[0]
    };
    tally(metrics, assessment.status);
    if (assessment.status === "closed" || assessment.status === "closes-too-soon") {
      eliminated.push({ candidate: next, assessment });
      return;
    }
    if (kept.length < EVALUATION_CANDIDATE_LIMIT) kept.push(next);
  };

  const worker = async (): Promise<void> => {
    while (kept.length < EVALUATION_CANDIDATE_LIMIT) {
      const index = cursor;
      cursor += 1;
      const candidate = pool[index];
      if (!candidate) return;
      await assess(candidate);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(HOURS_ENRICH_CONCURRENCY, pool.length) }, () => worker())
  );

  return { kept, eliminated, metrics };
}

export function applyHoursVeto(
  evaluations: Array<{ candidateId: string; rejected: boolean; score: number; label: string }>,
  candidates: RestaurantCandidate[]
): void {
  const blocked = new Set(
    candidates
      .filter(
        (candidate) =>
          candidate.hoursAssessment?.status === "closed" ||
          candidate.hoursAssessment?.status === "closes-too-soon"
      )
      .map((candidate) => candidate.id)
  );
  for (const evaluation of evaluations) {
    if (!blocked.has(evaluation.candidateId)) continue;
    evaluation.rejected = true;
    evaluation.score = 0;
    evaluation.label = "Constraint conflict";
  }
}

export function applyHumanHoursEvidence(
  candidate: RestaurantCandidate,
  result: "supports" | "contradicts" | "uncertain",
  retrievedAt: string
): RestaurantCandidate {
  const current = candidate.hoursAssessment;
  if (!current) return candidate;
  if (current.status !== "unknown") {
    return {
      ...candidate,
      hoursAssessment: {
        ...current,
        source: {
          provider: current.source?.provider ?? "human",
          retrievedAt,
          type: "human"
        }
      }
    };
  }
  const status = result === "supports" ? "suitable" : result === "contradicts" ? "closed" : "unknown";
  return {
    ...candidate,
    hoursAssessment: {
      ...current,
      status,
      source: { provider: "human", retrievedAt, type: "human" }
    }
  };
}
