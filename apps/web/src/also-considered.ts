import type { RestaurantView } from "./restaurant-display";

export interface AlsoConsideredContext {
  restaurant: RestaurantView;
  evaluations: Array<{
    participantId: string;
    score: number;
    label: string;
    rejected: boolean;
    privateConflict?: boolean;
  }>;
  constraints: Array<{
    participantId: string;
    type: string;
    value: unknown;
    priority: string;
    visibility?: string;
  }>;
  topScores: number[];
  hasOpenVerification?: boolean;
  publicDislike?: boolean;
  publicReject?: boolean;
}

function requirementLabel(value: unknown): string {
  if (typeof value === "string") return value.replaceAll("-", " ");
  if (Array.isArray(value)) {
    const first = value[0];
    if (first && typeof first === "object" && "requirement" in first) {
      return String((first as { requirement: string }).requirement).replaceAll("-", " ");
    }
    if (typeof first === "string") return first.replaceAll("-", " ");
  }
  if (value && typeof value === "object" && "requirement" in (value as object)) {
    return String((value as { requirement: string }).requirement).replaceAll("-", " ");
  }
  return "this dietary need";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

export function councilScoreFor(evaluations: AlsoConsideredContext["evaluations"]): number {
  const viable = evaluations.filter((item) => !item.rejected);
  if (!viable.length) return 0;
  return Math.round(viable.reduce((sum, item) => sum + item.score, 0) / viable.length);
}

export function whyNotRecommended(input: AlsoConsideredContext): string[] {
  const reasons: string[] = [];
  const { restaurant, evaluations, constraints } = input;
  const rejected = evaluations.some((item) => item.rejected);
  const privateReject = evaluations.some((item) => item.rejected && item.privateConflict);
  const assessments = restaurant.dietaryAssessments ?? [];
  const publicConstraints = constraints.filter(
    (constraint) => (constraint.visibility ?? "PUBLIC") === "PUBLIC"
  );

  if (rejected || input.publicReject) {
    if (privateReject && !evaluations.some((item) => item.rejected && !item.privateConflict)) {
      reasons.push("This restaurant doesn't work for everyone.");
    } else {
      reasons.push("It conflicts with a hard group constraint.");
    }
  }

  const hours = restaurant.hoursAssessment;
  if (hours && (hours.status === "closes-too-soon" || hours.status === "closed") && reasons.length < 2) {
    const close = hours.applicablePeriod?.closesAt;
    reasons.push(
      hours.status === "closed"
        ? "It is not open at the event start time."
        : close
          ? `It closes too soon for the event start.`
          : "It closes too soon for this event."
    );
  }
  if (hours?.status === "unknown" && reasons.length < 2) {
    reasons.push("Published hours could not be verified for the event time.");
  }

  const unsupported = assessments.find((item) => item.status === "unsupported");
  if (unsupported && !reasons.length) {
    reasons.push(
      `${requirementLabel(unsupported.requirement)} is not supported by published information.`
    );
  }

  const uncertain = assessments.find(
    (item) => item.status === "uncertain" || item.status === "conflicting"
  );
  if (uncertain && reasons.length < 2) {
    reasons.push(
      uncertain.status === "conflicting"
        ? `Published ${requirementLabel(uncertain.requirement)} information is conflicting.`
        : `${requirementLabel(uncertain.requirement)} accommodation is still uncertain.`
    );
  }

  if (input.hasOpenVerification && reasons.length < 2) {
    reasons.push("The Council wanted a requirement verified before recommending it.");
  }

  const score = councilScoreFor(evaluations);
  const top = input.topScores.filter((item) => item > 0);
  const best = top.length ? Math.max(...top) : 0;
  if (!rejected && best > 0 && score + 4 < best && reasons.length < 2) {
    reasons.push(`Lower Council match (${score}%) than the current picks (${best}%).`);
  }

  const cuisinePrefers = publicConstraints.filter((item) => item.type === "CUISINE_PREFER");
  if (cuisinePrefers.length && reasons.length < 2) {
    const wanted = cuisinePrefers.flatMap((item) => asStringArray(item.value).map((value) => value.toLowerCase()));
    const have = restaurant.cuisines.map((item) => item.toLowerCase());
    if (wanted.length && !wanted.some((item) => have.includes(item))) {
      reasons.push("It doesn't match the group's preferred cuisine as closely.");
    }
  }

  const outdoor = publicConstraints.find(
    (item) => item.type === "OUTDOOR_SEATING" && item.value === true
  );
  if (outdoor && restaurant.outdoorSeating === false && reasons.length < 2) {
    reasons.push("No outdoor seating.");
  }

  if (input.publicDislike && reasons.length < 2) {
    reasons.push("Someone in the group disliked this restaurant.");
  }

  if (reasons.length === 0) {
    reasons.push("A solid option, but the Council ranked other restaurants higher.");
  }

  return reasons.slice(0, 2);
}
