import type { CandidateEvaluation, RestaurantCandidate, RestaurantDecision } from "@rc/protocol";

export function applyDecisionsToEvaluations(
  evaluations: CandidateEvaluation[],
  decisions: RestaurantDecision[]
): CandidateEvaluation[] {
  return evaluations.map((evaluation) => {
    const decision = decisions.find(
      (item) => item.userId === evaluation.participantId && item.restaurantId === evaluation.candidateId
    );
    if (!decision || decision.decision === "neutral") return evaluation;
    if (decision.decision === "reject") {
      return {
        ...evaluation,
        score: 0,
        rejected: true,
        privateConflict: decision.visibility === "private" || evaluation.privateConflict,
        label: "Constraint conflict",
        reasonCode:
          decision.visibility === "private" ? "PRIVATE_CONSTRAINT_CONFLICT" : "HARD_CONSTRAINT_CONFLICT"
      };
    }
    let score = evaluation.score;
    if (decision.decision === "dislike") score -= 12;
    if (decision.decision === "prefer") score += 15;
    if (decision.decision === "approve") score += 5;
    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
      ...evaluation,
      score,
      label: evaluation.rejected
        ? evaluation.label
        : score >= 85
          ? "Strong match"
          : score >= 70
            ? "Good match"
            : score >= 55
              ? "Acceptable"
              : "Weak match"
    };
  });
}

export function candidateStatus(input: {
  candidate: RestaurantCandidate;
  evaluations: CandidateEvaluation[];
  tasks: Array<{ restaurantId: string; status: string }>;
  finalistIds: string[];
}): "active" | "needs-verification" | "rejected" | "eliminated" | "finalist" {
  const evals = input.evaluations.filter((item) => item.candidateId === input.candidate.id);
  if (evals.some((item) => item.rejected)) return "rejected";
  if (input.finalistIds.includes(input.candidate.id)) return "finalist";
  const openTask = input.tasks.some(
    (task) =>
      task.restaurantId === input.candidate.id && (task.status === "open" || task.status === "claimed")
  );
  const uncertain = (input.candidate.dietaryAssessments ?? []).some((item) => item.status === "uncertain");
  if (openTask || uncertain) return "needs-verification";
  if (evals.length && evals.every((item) => item.score < 45)) return "eliminated";
  return "active";
}
