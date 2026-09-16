import type { PersonalAgentPrincipal } from "@rc/auth";
import type { CandidateEvaluation, CouncilConstraint, RestaurantCandidate } from "@rc/protocol";
import { AppError, ErrorCodes } from "@rc/shared";
import { assessConstraint } from "./constraint-check.ts";
import type { AgentRuntime } from "./runtime.ts";
import { EvaluationsLlmSchema } from "./schemas.ts";

function reputationBonus(rating?: number, reviewCount?: number): number {
  if (rating == null || rating <= 0) return 0;
  const n = reviewCount && reviewCount > 0 ? reviewCount : 0;
  const blended = (rating * n + 3.7 * 40) / (n + 40);
  return Math.max(0, Math.min(8, (blended - 3.2) * 5));
}

function labelFor(score: number, rejected: boolean): CandidateEvaluation["label"] {
  if (rejected) return "Constraint conflict";
  if (score >= 85) return "Strong match";
  if (score >= 70) return "Good match";
  if (score >= 55) return "Acceptable";
  return "Weak match";
}

export function evaluateCandidate(input: {
  principal: PersonalAgentPrincipal;
  candidate: RestaurantCandidate;
  constraints: CouncilConstraint[];
}): CandidateEvaluation {
  const mine = input.constraints.filter(
    (constraint) => constraint.participantId === input.principal.actingFor
  );

  let score = 60;
  let rejected = false;
  let privateConflict = false;
  let publicConflict = false;
  let hardConflict = false;

  for (const constraint of mine) {
    const isPrivate = constraint.visibility === "PRIVATE_DERIVED";
    const weight =
      constraint.priority === "HARD"
        ? 25
        : constraint.priority === "HIGH"
          ? 18
          : constraint.priority === "MEDIUM"
            ? 10
            : 5;

    const fail = () => {
      rejected = constraint.priority === "HARD" || constraint.priority === "HIGH";
      if (isPrivate) privateConflict = true;
      else publicConflict = true;
      if (constraint.priority === "HARD") hardConflict = true;
      score -= weight;
    };

    const pass = () => {
      score += weight;
    };

    const assessment = assessConstraint(constraint, input.candidate);
    if (assessment.kind === "fail") fail();
    else if (assessment.kind === "pass") pass();
    else if (assessment.kind === "soft") score -= weight / 2;
    else if (assessment.kind === "bonus") score += assessment.points;
  }

  score = Math.max(0, Math.min(100, Math.round(score + reputationBonus(input.candidate.rating, input.candidate.reviewCount))));

  let reasonCode: CandidateEvaluation["reasonCode"] = "MATCH";
  if (rejected && privateConflict) reasonCode = "PRIVATE_CONSTRAINT_CONFLICT";
  else if (hardConflict) reasonCode = "HARD_CONSTRAINT_CONFLICT";
  else if (rejected && publicConflict) reasonCode = "PUBLIC_CONSTRAINT_CONFLICT";
  else if (score < 55) reasonCode = "WEAK_MATCH";

  return {
    candidateId: input.candidate.id,
    participantId: input.principal.actingFor,
    score,
    label: labelFor(score, rejected),
    reasonCode,
    rejected,
    privateConflict
  };
}

function mergeEvaluation(
  baseline: CandidateEvaluation,
  proposed:
    | {
        score: number;
        label: CandidateEvaluation["label"];
        reasonCode: CandidateEvaluation["reasonCode"];
        rejected: boolean;
        privateConflict: boolean;
      }
    | undefined,
  hasPrivateConstraints: boolean
): CandidateEvaluation {
  if (!proposed) return baseline;
  if (baseline.rejected) {
    return {
      ...baseline,
      score: Math.min(baseline.score, Math.round(proposed.score))
    };
  }
  if (proposed.rejected) {
    return baseline;
  }
  const privateConflict =
    hasPrivateConstraints && (baseline.privateConflict || proposed.privateConflict);
  const score = Math.max(0, Math.min(100, Math.round(proposed.score)));
  return {
    candidateId: baseline.candidateId,
    participantId: baseline.participantId,
    score,
    label: labelFor(score, false),
    reasonCode: proposed.reasonCode === "MATCH" || proposed.reasonCode === "WEAK_MATCH"
      ? proposed.reasonCode
      : baseline.reasonCode,
    rejected: false,
    privateConflict
  };
}

const EVALUATE_SYSTEM = `You are a Personal Agent scoring restaurants for one participant.
Use only the supplied constraints. Do not invent the participant's finances or private story.
privateConflict may be true only when a PRIVATE_DERIVED constraint is violated.
Do not include explanations or original preference text.
label must be exactly one of: "Strong match", "Good match", "Acceptable", "Weak match", "Constraint conflict".
Never use REJECTED as a label; a rejection is label "Constraint conflict" with rejected true.
reasonCode must be exactly one of: MATCH, WEAK_MATCH, PUBLIC_CONSTRAINT_CONFLICT, PRIVATE_CONSTRAINT_CONFLICT, HARD_CONSTRAINT_CONFLICT.
Never put a constraint type such as PRICE_LEVEL or CUISINE_PREFER in reasonCode.
score is an integer from 0 to 100, not a 1-5 rating. Good match is 70-84. Strong match is 85-100.
Restaurant rating and reviewCount are a soft signal only. Do not pick a winner from stars alone; few reviews should not outrank a slightly lower rating with many reviews.
Dietary assessments are evidence-backed. confirmed or likely may satisfy a requirement. uncertain and conflicting are not failures — never set rejected true for them. unsupported fails a required dietary constraint. Do not invent dietary claims or reject because a provider field is missing.
Return JSON: {"evaluations":[{"candidateId","score","label","reasonCode","rejected","privateConflict"}]}`;

export async function evaluateCandidates(input: {
  principal: PersonalAgentPrincipal;
  candidates: RestaurantCandidate[];
  constraints: CouncilConstraint[];
  runtime?: AgentRuntime;
}): Promise<CandidateEvaluation[]> {
  const baseline = input.candidates.map((candidate) =>
    evaluateCandidate({
      principal: input.principal,
      candidate,
      constraints: input.constraints
    })
  );
  if (!input.runtime || input.candidates.length === 0) return baseline;

  const mine = input.constraints.filter(
    (constraint) => constraint.participantId === input.principal.actingFor
  );
  const hasPrivate = mine.some((constraint) => constraint.visibility === "PRIVATE_DERIVED");

  const result = await input.runtime.completeStructured({
    system: EVALUATE_SYSTEM,
    user: JSON.stringify({
      constraints: mine,
      candidates: input.candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        priceLevel: candidate.priceLevel,
        rating: candidate.rating,
        reviewCount: candidate.reviewCount,
        cuisines: candidate.cuisines,
        outdoorSeating: candidate.outdoorSeating,
        dietaryOptions: candidate.dietaryOptions,
        dietaryAssessments: (candidate.dietaryAssessments ?? []).map((item) => ({
          requirement: item.requirement,
          status: item.status
        })),
        distanceKm: candidate.distanceKm
      }))
    }),
    schema: EvaluationsLlmSchema
  }).catch((error: unknown) => {
    throw new AppError(
      ErrorCodes.AGENT_RUNTIME_FAILED,
      error instanceof Error
        ? `Personal agent evaluation failed: ${error.message}`
        : "Personal agent evaluation failed",
      502
    );
  });
  const byId = new Map(result.evaluations.map((item) => [item.candidateId, item]));
  return baseline.map((item) =>
    mergeEvaluation(item, byId.get(item.candidateId), hasPrivate)
  );
}
