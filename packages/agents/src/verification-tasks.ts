import type { CouncilConstraint, RestaurantCandidate, VerificationTask } from "@rc/protocol";
import { dietaryConstraintsFromCouncil, suggestedVerificationQuestion } from "@rc/protocol";
import { AppError, ErrorCodes, createId, nowIso } from "@rc/shared";

export function verificationTasksFromCouncil(input: {
  eventId: string;
  candidates: RestaurantCandidate[];
  constraints: CouncilConstraint[];
  evaluations: Array<{ candidateId: string; rejected: boolean; score: number }>;
  existing: VerificationTask[];
  limit?: number;
}): VerificationTask[] {
  const dietary = dietaryConstraintsFromCouncil(input.constraints);
  if (dietary.length === 0) return [];
  const existingKeys = new Set(
    input.existing
      .filter((task) => task.status === "open" || task.status === "claimed")
      .map((task) => `${task.restaurantId}:${task.requirementType}:${String(task.requirementValue ?? "")}`)
  );
  const scored = input.candidates
    .map((candidate) => {
      const evals = input.evaluations.filter((item) => item.candidateId === candidate.id);
      if (evals.some((item) => item.rejected)) return null;
      const avg = evals.length ? evals.reduce((sum, item) => sum + item.score, 0) / evals.length : 0;
      if (avg < 62) return null;
      const uncertain = (candidate.dietaryAssessments ?? []).filter((item) => item.status === "uncertain");
      if (uncertain.length === 0) return null;
      return { candidate, avg, uncertain };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.avg - a.avg);

  const tasks: VerificationTask[] = [];
  for (const item of scored) {
    for (const assessment of item.uncertain) {
      const constraint = dietary.find((need) => need.requirement === assessment.requirement);
      const key = `${item.candidate.id}:dietary:${assessment.requirement}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      tasks.push({
        id: createId("vtk"),
        eventId: input.eventId,
        restaurantId: item.candidate.id,
        requirementType: "dietary",
        requirementValue: assessment.requirement,
        question: suggestedVerificationQuestion(
          "dietary",
          assessment.requirement,
          constraint?.evidenceRequirement === "strict"
        ),
        status: "open",
        createdBy: { type: "system" },
        createdAt: nowIso()
      });
      if (tasks.length >= (input.limit ?? 3)) return tasks;
    }
  }
  return tasks;
}

export function claimVerificationTask(task: VerificationTask, userId: string): VerificationTask {
  if (task.status !== "open") {
    throw new AppError(ErrorCodes.CONFLICT, "That verification task is no longer open", 409);
  }
  return {
    ...task,
    status: "claimed",
    assignedToUserId: userId,
    claimedAt: nowIso()
  };
}

export function releaseVerificationTask(
  task: VerificationTask,
  userId: string,
  isOwner: boolean
): VerificationTask {
  if (task.assignedToUserId !== userId && !isOwner) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Only the claimer or host can release this task", 403);
  }
  if (task.status !== "claimed") {
    throw new AppError(ErrorCodes.CONFLICT, "Only a claimed task can be released", 409);
  }
  return {
    ...task,
    status: "open",
    assignedToUserId: undefined,
    claimedAt: undefined
  };
}

export function completeVerificationTask(task: VerificationTask, userId: string): VerificationTask {
  if (task.status !== "claimed" || task.assignedToUserId !== userId) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Claim this task before submitting a result", 403);
  }
  return {
    ...task,
    status: "completed",
    completedAt: nowIso()
  };
}
