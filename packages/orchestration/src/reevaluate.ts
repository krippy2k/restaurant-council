import { evaluateCandidates, negotiate, applyDecisionsToEvaluations } from "@rc/agents";
import { createNegotiatorPrincipal, createPersonalAgentPrincipal } from "@rc/auth";
import type {
  CouncilProgress,
  CouncilSnapshot,
  HumanEvidence,
  RestaurantDecision
} from "@rc/protocol";
import { createId, nowIso } from "@rc/shared";
import { assessDietaryEvidence, makeEvidence } from "@rc/tools";
import { applyHumanHoursEvidence, applyHoursVeto } from "./hours.ts";
import type { AgentRuntime } from "@rc/agents";
import type { CouncilConstraint } from "@rc/protocol";
import { mediaByRestaurantId, mergeRestaurantMedia } from "./candidate-media.ts";
import {
  createProgressReporter,
  instrumentRuntime,
  negotiatorProgress,
  personalAgentProgress
} from "./progress.ts";
import type { CouncilSpendTracker } from "./spend.ts";

export function mergeHumanEvidenceIntoCandidates(
  snapshot: CouncilSnapshot,
  evidence: HumanEvidence[]
): CouncilSnapshot {
  const candidates = snapshot.candidates.map((candidate) => {
    const hoursEvidence = evidence.filter(
      (item) => item.restaurantId === candidate.id && item.requirementType === "opening-hours"
    );
    const latestHours = hoursEvidence.at(-1);
    const withHours = latestHours
      ? applyHumanHoursEvidence(candidate, latestHours.result, latestHours.verifiedAt)
      : candidate;
    const mine = evidence.filter(
      (item) => item.restaurantId === candidate.id && item.requirementType === "dietary"
    );
    if (!mine.length) return withHours;
    const assessments = (candidate.dietaryAssessments ?? []).map((assessment) => {
      const extra = mine.filter((item) => String(item.requirementValue ?? "") === assessment.requirement);
      if (!extra.length) return assessment;
      const mapped = extra.map((item) =>
        makeEvidence({
          sourceType: "human-verification",
          sourceName: item.visibility === "event" ? "Participant verification" : "Private verification",
          observedAt: item.verifiedAt,
          excerpt: item.visibility === "event" ? item.notes : undefined,
          supports:
            item.result === "supports" ? "supports" : item.result === "contradicts" ? "contradicts" : "neutral",
          reliability: item.method === "phone" || item.method === "in-person" ? "high" : "medium",
          scope: "location"
        })
      );
      return assessDietaryEvidence({
        restaurantId: candidate.id,
        requirement: assessment.requirement,
        evidence: [...assessment.evidence, ...mapped],
        evidenceRequirement: "normal"
      });
    });
    return { ...withHours, dietaryAssessments: assessments };
  });
  return { ...snapshot, candidates };
}

export async function reevaluateCouncil(input: {
  snapshot: CouncilSnapshot;
  decisions: RestaurantDecision[];
  evidence: HumanEvidence[];
  constraints?: CouncilConstraint[];
  runtime?: AgentRuntime;
  spend?: CouncilSpendTracker;
  reportProgress?: (progress: CouncilProgress, snapshot: CouncilSnapshot) => Promise<void>;
}): Promise<CouncilSnapshot> {
  const withEvidence = mergeHumanEvidenceIntoCandidates(input.snapshot, input.evidence);
  const media = mediaByRestaurantId(input.snapshot);
  const candidates = withEvidence.candidates.map((candidate) =>
    mergeRestaurantMedia(candidate, media.get(candidate.id))
  );
  const constraints = input.constraints ?? withEvidence.constraints;
  const working: CouncilSnapshot = {
    ...withEvidence,
    candidates,
    constraints,
    status: "EVALUATING"
  };
  const reporter = createProgressReporter(working, {
    emit: async () => undefined,
    reportProgress: input.reportProgress,
    spend: input.spend
  });
  const runtime = instrumentRuntime(input.runtime, reporter) ?? input.runtime;
  const evaluations = [];
  for (const participant of withEvidence.participants) {
    const principal = createPersonalAgentPrincipal({
      userId: participant.userId,
      eventId: withEvidence.eventId
    });
    await reporter.begin({
      phase: "EVALUATING",
      step: `${participant.displayName}'s agent is re-scoring restaurants`,
      agent: personalAgentProgress(participant.displayName, participant.userId)
    });
    const batch = await evaluateCandidates({
      principal,
      candidates,
      constraints,
      runtime
    });
    evaluations.push(
      ...applyDecisionsToEvaluations(
        batch,
        input.decisions
      )
    );
  }
  applyHoursVeto(evaluations, candidates);
  await reporter.begin({
    phase: "NEGOTIATING",
    step: "Updating recommendations",
    agent: negotiatorProgress()
  });
  working.status = "NEGOTIATING";
  const recommendations = await negotiate({
    principal: createNegotiatorPrincipal(withEvidence.eventId),
    eventId: withEvidence.eventId,
    constraints,
    candidates,
    evaluations,
    runtime
  });
  for (const recommendation of recommendations) {
    recommendation.candidate = mergeRestaurantMedia(
      recommendation.candidate,
      media.get(recommendation.candidate.id)
    );
    const veto = input.decisions.find(
      (item) => item.restaurantId === recommendation.candidate.id && item.decision === "reject"
    );
    if (veto?.visibility === "private") {
      recommendation.rejected = true;
      recommendation.rejectionSummary = "This restaurant doesn't work for everyone.";
    }
  }
  const at = nowIso();
  working.status = "COMPLETE";
  working.evaluations = evaluations;
  working.recommendations = recommendations;
  await reporter.complete("COMPLETE", "Council evaluation updated");
  return {
    ...working,
    candidates,
    evaluations,
    recommendations,
    status: "COMPLETE",
    progress: working.progress,
    events: [
      ...withEvidence.events,
      {
        type: "collaboration.updated",
        at,
        message: "I've updated the Council evaluation.",
        payload: { actionId: createId("cact") }
      }
    ]
  };
}
