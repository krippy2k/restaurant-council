import type { CouncilConstraint, RestaurantCandidate, VerificationTask } from "@rc/protocol";
import {
  dietaryConstraintsFromCouncil,
  formatHoursClock,
  suggestedVerificationQuestion
} from "@rc/protocol";
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
      return { candidate, avg };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.avg - a.avg);

  const tasks: VerificationTask[] = [];
  for (const item of scored) {
    const hours = item.candidate.hoursAssessment;
    if (hours?.status === "unknown") {
      const key = `${item.candidate.id}:opening-hours:event-time`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        const timeZone = item.candidate.openingHours?.timeZone ?? "UTC";
        tasks.push({
          id: createId("vtk"),
          eventId: input.eventId,
          restaurantId: item.candidate.id,
          requirementType: "opening-hours",
          requirementValue: "event-time",
          question:
            hours.eventDateTime && hours.requiredOpenUntil
              ? `Will you be open at ${formatHoursClock(hours.eventDateTime, timeZone)} and remain open until at least ${formatHoursClock(hours.requiredOpenUntil, timeZone)}?`
              : suggestedVerificationQuestion("opening-hours", "event-time"),
          status: "open",
          createdBy: { type: "system" },
          createdAt: nowIso()
        });
        console.info(JSON.stringify({ metric: "restaurant_hours_human_verification_requested" }));
        if (input.limit != null && tasks.length >= input.limit) return tasks;
      }
    }

    if (dietary.length === 0) continue;
    const uncertain = (item.candidate.dietaryAssessments ?? []).filter(
      (assessment) => assessment.status === "uncertain" || assessment.status === "conflicting"
    );
    for (const assessment of uncertain) {
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
      if (input.limit != null && tasks.length >= input.limit) return tasks;
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
