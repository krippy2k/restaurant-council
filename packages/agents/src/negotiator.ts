import { assertAuthorized, type NegotiatorPrincipal } from "@rc/auth";
import type {
  CandidateEvaluation,
  CouncilConstraint,
  Recommendation,
  RestaurantCandidate
} from "@rc/protocol";
import type { AgentRuntime } from "./runtime.ts";
import { publicRejectionReasons } from "./rejection-reasons.ts";
import { NegotiationLlmSchema } from "./schemas.ts";

function evaluationsByParticipant(
  evaluations: CandidateEvaluation[]
): CandidateEvaluation[] {
  const byParticipant = new Map<string, CandidateEvaluation>();
  for (const evaluation of evaluations) {
    const existing = byParticipant.get(evaluation.participantId);
    if (!existing) {
      byParticipant.set(evaluation.participantId, evaluation);
      continue;
    }
    if (evaluation.rejected && !existing.rejected) {
      byParticipant.set(evaluation.participantId, evaluation);
    }
  }
  return [...byParticipant.values()];
}

function explanationFor(
  candidate: RestaurantCandidate,
  evaluations: CandidateEvaluation[],
  constraints: CouncilConstraint[]
): { explanations: string[]; rejected: boolean; rejectionSummary?: string } {
  const hardRejects = evaluations.filter((evaluation) => evaluation.rejected);
  if (hardRejects.length > 0) {
    const privateReject = hardRejects.some((evaluation) => evaluation.privateConflict);
    return {
      explanations: [],
      rejected: true,
      rejectionSummary: privateReject
        ? "Rejected — conflicts with a private high-priority preference."
        : "Rejected — conflicts with a hard group constraint."
    };
  }

  const explanations: string[] = [];
  const withinHard = constraints
    .filter((constraint) => constraint.priority === "HARD")
    .every((constraint) => {
      if (constraint.type === "MAX_PRICE_LEVEL") {
        if (candidate.priceLevel == null) return true;
        return candidate.priceLevel <= Number(constraint.value);
      }
      return true;
    });
  if (withinHard) explanations.push("Within everyone's hard constraints");

  const strong = evaluations.filter((evaluation) => evaluation.score >= 85).length;
  if (strong > 0) {
    explanations.push(`Strong match for ${strong}/${evaluations.length} members`);
  }

  if (candidate.outdoorSeating) explanations.push("Outdoor seating available");
  const dietary = candidate.dietaryAssessments ?? [];
  if (dietary.some((item) => item.status === "confirmed")) {
    explanations.push("Meets the group's dietary requirements");
  } else if (dietary.some((item) => item.status === "likely")) {
    explanations.push("Likely to meet the group's dietary requirements");
  }
  if ((candidate.rating ?? 0) >= 4.4 && (candidate.reviewCount ?? 0) >= 50) {
    explanations.push("Strong diner ratings");
  }

  return { explanations, rejected: false };
}

const UNSAFE_EXPLANATION =
  /afford|budget|salary|lost (a |the )?job|money is tight|can't pay|cannot pay|under \$\d+|max_price|price level|private preference was|told me that|allerg(y|ies)|celiac|medical|has a dairy|don't tell/i;

export function isSafeExplanation(text: string): boolean {
  return text.trim().length > 0 && text.length <= 180 && !UNSAFE_EXPLANATION.test(text);
}

function rankRecommendations(input: {
  candidates: RestaurantCandidate[];
  evaluations: CandidateEvaluation[];
  constraints: CouncilConstraint[];
}): Recommendation[] {
  const byCandidate = new Map<string, Recommendation>();

  for (const candidate of input.candidates) {
    const evaluations = evaluationsByParticipant(
      input.evaluations.filter((evaluation) => evaluation.candidateId === candidate.id)
    );
    const { explanations, rejected, rejectionSummary } = explanationFor(
      candidate,
      evaluations,
      input.constraints
    );
    const rejectionReasons = rejected
      ? publicRejectionReasons(candidate, input.constraints, evaluations)
      : undefined;
    const viable = evaluations.filter((evaluation) => !evaluation.rejected);
    const councilScore =
      viable.length === 0
        ? 0
        : Math.round(
            viable.reduce((sum, evaluation) => sum + evaluation.score, 0) / viable.length
          );

    byCandidate.set(candidate.id, {
      candidate,
      councilScore,
      evaluations,
      explanations,
      rejected,
      rejectionSummary,
      rejectionReasons
    });
  }

  return [...byCandidate.values()].sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
    return b.councilScore - a.councilScore;
  });
}

const MEMBER_COUNT_EXPLANATION = /\d+\s*\/\s*\d+\s+members|\b\d+\s+members\b/i;

function mergeExplanations(computed: string[], proposed: string[]): string[] {
  const extras = proposed.filter(
    (text) => isSafeExplanation(text) && !MEMBER_COUNT_EXPLANATION.test(text)
  );
  const merged = [...computed];
  for (const extra of extras) {
    if (!merged.includes(extra)) merged.push(extra);
  }
  return merged;
}

const NEGOTIATE_SYSTEM = `You are the Negotiator Agent for a restaurant council.
You may use PRIVATE_DERIVED constraint values to choose restaurants.
You must NEVER mention private constraint types, values, money, jobs, or why someone rejected.
Do not name a participant next to a private reason.
Do not mention how many members matched; that ratio is computed separately.
Safe explanation examples: "Outdoor seating available", "Meets the group's dietary requirements", "Quiet enough for conversation".
Never mention allergies, medical conditions, or who requested a dietary need.
If a restaurant is rejected for a private reason, do not pick it.
Return JSON: {"picks":[{"candidateId":"...","explanations":["..."]}]}`;

export async function negotiate(input: {
  principal: NegotiatorPrincipal;
  eventId: string;
  constraints: CouncilConstraint[];
  candidates: RestaurantCandidate[];
  evaluations: CandidateEvaluation[];
  runtime?: AgentRuntime;
}): Promise<Recommendation[]> {
  assertAuthorized({
    principal: input.principal,
    action: "negotiation.write",
    resource: { type: "negotiation", eventId: input.eventId }
  });

  const ranked = rankRecommendations(input);
  const viable = ranked.filter((item) => !item.rejected);
  const fallback = (viable.length > 0 ? viable : ranked).slice(0, 3);

  if (!input.runtime || viable.length === 0) return fallback;

  let result;
  try {
    result = await input.runtime.completeStructured({
      system: NEGOTIATE_SYSTEM,
      user: JSON.stringify({
        constraints: input.constraints.map((constraint) => ({
          participantId: constraint.participantId,
          type: constraint.type,
          value: constraint.value,
          priority: constraint.priority,
          visibility: constraint.visibility
        })),
        candidates: viable.map((item) => ({
          id: item.candidate.id,
          name: item.candidate.name,
          priceLevel: item.candidate.priceLevel,
          rating: item.candidate.rating,
          reviewCount: item.candidate.reviewCount,
          cuisines: item.candidate.cuisines,
          councilScore: item.councilScore
        })),
        evaluations: input.evaluations.filter((evaluation) => !evaluation.rejected)
      }),
      schema: NegotiationLlmSchema
    });
  } catch {
    return fallback;
  }

  const byId = new Map(viable.map((item) => [item.candidate.id, item]));
  const picked: Recommendation[] = [];
  for (const pick of result.picks) {
    const base = byId.get(pick.candidateId);
    if (!base || base.rejected) continue;
    const extras = pick.explanations;
    picked.push({
      ...base,
      explanations: mergeExplanations(base.explanations, extras)
    });
  }
  if (picked.length > 0) return picked.slice(0, 3);
  return fallback;
}
