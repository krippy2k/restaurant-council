import { Hono } from "hono";
import { assertAuthorized, createUserPrincipal } from "@rc/auth";
import type { PreferenceCategory } from "@rc/domain";
import {
  detectPreferenceFromChat,
  newPreferencePrompt,
  claimVerificationTask,
  releaseVerificationTask,
  completeVerificationTask
} from "@rc/agents";
import {
  CompleteVerificationInputSchema,
  PostChatInputSchema,
  UpsertDecisionInputSchema,
  labelReason,
  publicRejectionCopy,
  sanitizeChatMessage,
  sanitizeDecisionForViewer,
  sanitizeEvidenceForViewer,
  suggestedVerificationQuestion,
  type HumanEvidence,
  type RestaurantDecision,
  type VerificationTask
} from "@rc/protocol";
import { AppError, ErrorCodes, createId, nowIso } from "@rc/shared";
import type { Env } from "../env.ts";
import { newAction, newChatMessage } from "../db/collaboration.ts";
import { loadEventResource } from "./event-access.ts";
import { requireUser, type AppContext, type AppVariables } from "./session.ts";
import { collabMetric, notifyCouncil, requestReevaluate } from "./collab-notify.ts";
import { createEventResearchRegistry, executeAgentInvocation, startAgentFromChat } from "../services/agent-chat.ts";

export const collaborationRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function memberContext(
  c: AppContext,
  action: "chat.read" | "chat.write" | "collaboration.act" | "collaboration.moderate"
) {
  const identity = requireUser(c);
  const eventId = c.req.param("eventId");
  if (!eventId) throw new AppError(ErrorCodes.NOT_FOUND, "Event not found", 404);
  const loaded = await loadEventResource(c.get("db"), eventId);
  assertAuthorized({
    principal: createUserPrincipal(identity.userId),
    action,
    resource: loaded.resource
  });
  return { identity, loaded, db: c.get("db") };
}

function restaurantInEvent(snapshot: { candidates?: Array<{ id: string }> } | null, restaurantId: string): boolean {
  return Boolean(snapshot?.candidates?.some((item) => item.id === restaurantId));
}

collaborationRoutes.get("/:eventId/collaboration", async (c) => {
  const { identity, db } = await memberContext(c, "chat.read");
  const eventId = c.req.param("eventId");
  const [chat, tasks, evidence, decisions, actions, prompts] = await Promise.all([
    db.collab.listChat(eventId),
    db.collab.listTasks(eventId),
    db.collab.listEvidence(eventId),
    db.collab.listDecisions(eventId),
    db.collab.listActions(eventId),
    db.collab.listPrompts(eventId, identity.userId)
  ]);
  return c.json({
    chat: chat.map(sanitizeChatMessage),
    tasks,
    evidence: evidence
      .map((item) => sanitizeEvidenceForViewer(item, identity.userId))
      .filter((item): item is HumanEvidence => Boolean(item)),
    decisions: decisions.map((item) => sanitizeDecisionForViewer(item, identity.userId)),
    actions: actions.filter(
      (item) => item.visibility === "event" || item.actorUserId === identity.userId
    ),
    prompts: prompts.filter((item) => item.userId === identity.userId)
  });
});

collaborationRoutes.get("/:eventId/chat", async (c) => {
  const { db } = await memberContext(c, "chat.read");
  const chat = await db.collab.listChat(c.req.param("eventId"));
  return c.json({ chat: chat.map(sanitizeChatMessage) });
});

collaborationRoutes.post("/:eventId/chat", async (c) => {
  const { identity, db } = await memberContext(c, "chat.write");
  const allowed = await db.consumeRateLimit(`chat:${identity.userId}`, 60, 60 * 60 * 1000);
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many chat messages", 429);
  const body = PostChatInputSchema.parse(await c.req.json());
  const eventId = c.req.param("eventId");
  const registry = createEventResearchRegistry(c.env, db, eventId);
  const detectedMention = registry.detect(body.text);
  if (detectedMention) {
    const allowedAgent = await db.consumeRateLimit(`agent:${identity.userId}`, 20, 60 * 60 * 1000);
    if (!allowedAgent) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many agent requests", 429);
  }
  const message = newChatMessage({
    eventId,
    sender: { type: "user", userId: identity.userId },
    messageType: detectedMention ? "agent-request" : "text",
    text: body.text,
    relatedRestaurantId: body.relatedRestaurantId
  });
  await db.collab.insertChat(message);
  collabMetric("event_chat_messages_sent");
  let invocation;
  let progress;
  if (detectedMention) {
    const started = await startAgentFromChat({
      env: c.env,
      db,
      eventId,
      userId: identity.userId,
      source: message,
      query: detectedMention.mention.query,
      agentId: detectedMention.agent.id
    });
    invocation = started.invocation;
    progress = started.progress;
    collabMetric("agent_invocations_created");
    await executeAgentInvocation({ env: c.env, db, eventId, invocationId: invocation.id });
  }
  const detected = detectedMention
    ? undefined
    : detectPreferenceFromChat({
    eventId,
    userId: identity.userId,
    sourceMessageId: message.id,
    text: body.text
  });
  let prompt;
  if (detected) {
    const existing = await db.collab.listPrompts(eventId, identity.userId);
    const duplicate = existing.some(
      (item) => item.status === "pending" && item.question === detected.question
    );
    if (!duplicate) {
      prompt = newPreferencePrompt(detected);
      await db.collab.upsertPrompt(prompt);
      const confirm = newChatMessage({
        eventId,
        sender: { type: "council" },
        messageType: "preference-confirmation",
        text: prompt.question,
        relatedActionId: prompt.id
      });
      await db.collab.insertChat(confirm);
      collabMetric("preference_confirmation_prompted");
      await notifyCouncil(c.env, eventId, { type: "chat", message: confirm });
    }
  }
  await notifyCouncil(c.env, eventId, { type: "chat", message });
  if (progress) await notifyCouncil(c.env, eventId, { type: "chat", message: progress });
  return c.json({ message, prompt, invocation }, 201);
});

collaborationRoutes.get("/:eventId/agents/invocations/:invocationId", async (c) => {
  const { identity, db } = await memberContext(c, "chat.read");
  const invocation = await db.research.getInvocation(c.req.param("eventId"), c.req.param("invocationId"));
  if (!invocation) throw new AppError(ErrorCodes.NOT_FOUND, "Agent invocation not found", 404);
  if (invocation.visibility === "private" && invocation.userId !== identity.userId) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Private research is not visible", 403);
  }
  return c.json({ invocation });
});

collaborationRoutes.post("/:eventId/agents/invocations/:invocationId/retry", async (c) => {
  const { identity, db } = await memberContext(c, "chat.write");
  const invocation = await db.research.getInvocation(c.req.param("eventId"), c.req.param("invocationId"));
  if (!invocation) throw new AppError(ErrorCodes.NOT_FOUND, "Agent invocation not found", 404);
  if (invocation.userId !== identity.userId) {
    throw new AppError(ErrorCodes.FORBIDDEN, "You can only retry your own research", 403);
  }
  if (invocation.status !== "failed") {
    throw new AppError(ErrorCodes.CONFLICT, "Only failed research can be retried", 409);
  }
  const allowedAgent = await db.consumeRateLimit(`agent:${identity.userId}`, 20, 60 * 60 * 1000);
  if (!allowedAgent) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many agent requests", 429);
  await db.research.updateInvocation({
    ...invocation,
    status: "queued",
    errorCode: undefined,
    errorMessage: undefined,
    completedAt: undefined
  });
  await executeAgentInvocation({
    env: c.env,
    db,
    eventId: invocation.eventId,
    invocationId: invocation.id
  });
  return c.json({ invocation: { ...invocation, status: "queued" } });
});

collaborationRoutes.post("/:eventId/agents/invocations", async (c) => {
  const { identity, db } = await memberContext(c, "chat.write");
  const eventId = c.req.param("eventId");
  const body = await c.req.json<{ query?: string; visibility?: "event" | "private"; relatedRestaurantId?: string }>();
  const query = body.query?.trim();
  if (!query) throw new AppError(ErrorCodes.VALIDATION, "Query is required", 400);
  const allowedAgent = await db.consumeRateLimit(`agent:${identity.userId}`, 20, 60 * 60 * 1000);
  if (!allowedAgent) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many agent requests", 429);
  const visibility = body.visibility === "private" ? "private" : "event";
  const source = newChatMessage({
    eventId,
    sender: { type: "user", userId: identity.userId },
    messageType: "agent-request",
    text: query,
    relatedRestaurantId: body.relatedRestaurantId
  });
  if (visibility === "event") await db.collab.insertChat(source);
  const started = await startAgentFromChat({
    env: c.env,
    db,
    eventId,
    userId: identity.userId,
    source,
    query,
    agentId: "restaurant-research",
    visibility
  });
  await executeAgentInvocation({ env: c.env, db, eventId, invocationId: started.invocation.id });
  if (started.progress && visibility === "event") {
    await notifyCouncil(c.env, eventId, { type: "chat", message: started.progress });
  }
  return c.json({ invocation: started.invocation }, 201);
});

collaborationRoutes.patch("/:eventId/chat/:messageId", async (c) => {
  const { identity, db } = await memberContext(c, "chat.write");
  const existing = await db.collab.getChat(c.req.param("eventId"), c.req.param("messageId"));
  if (!existing || existing.sender.type !== "user" || existing.sender.userId !== identity.userId) {
    throw new AppError(ErrorCodes.FORBIDDEN, "You can only edit your messages", 403);
  }
  const body = PostChatInputSchema.partial().parse(await c.req.json());
  const next = { ...existing, text: body.text ?? existing.text, editedAt: nowIso() };
  await db.collab.updateChat(next);
  await notifyCouncil(c.env, existing.eventId, { type: "chat", message: next });
  return c.json({ message: next });
});

collaborationRoutes.delete("/:eventId/chat/:messageId", async (c) => {
  const { identity, db } = await memberContext(c, "chat.write");
  const existing = await db.collab.getChat(c.req.param("eventId"), c.req.param("messageId"));
  if (!existing || existing.sender.type !== "user" || existing.sender.userId !== identity.userId) {
    throw new AppError(ErrorCodes.FORBIDDEN, "You can only delete your messages", 403);
  }
  const next = { ...existing, deletedAt: nowIso(), text: undefined };
  await db.collab.updateChat(next);
  await notifyCouncil(c.env, existing.eventId, { type: "chat", message: sanitizeChatMessage(next) });
  return c.json({ message: sanitizeChatMessage(next) });
});

collaborationRoutes.get("/:eventId/actions", async (c) => {
  const { identity, db } = await memberContext(c, "chat.read");
  const actions = await db.collab.listActions(c.req.param("eventId"));
  return c.json({
    actions: actions.filter((item) => item.visibility === "event" || item.actorUserId === identity.userId)
  });
});

collaborationRoutes.put("/:eventId/restaurants/:restaurantId/decisions/me", async (c) => {
  const { identity, db } = await memberContext(c, "collaboration.act");
  const allowed = await db.consumeRateLimit(`collab-act:${identity.userId}`, 80, 60 * 60 * 1000);
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many collaboration actions", 429);
  const eventId = c.req.param("eventId");
  const restaurantId = c.req.param("restaurantId");
  const snapshot = await db.getCouncilSnapshot(eventId);
  if (!restaurantInEvent(snapshot, restaurantId)) {
    throw new AppError(ErrorCodes.VALIDATION, "Restaurant is not a council candidate", 400);
  }
  const body = UpsertDecisionInputSchema.parse(await c.req.json());
  const previous = (await db.collab.listDecisions(eventId)).find(
    (item) => item.userId === identity.userId && item.restaurantId === restaurantId
  );
  const decision: RestaurantDecision = {
    id: previous?.id ?? createId("rdc"),
    eventId,
    restaurantId,
    userId: identity.userId,
    decision: body.decision,
    reasonCategory: body.reasonCategory,
    note: body.note,
    visibility: body.visibility,
    createdAt: previous?.createdAt ?? nowIso(),
    updatedAt: nowIso()
  };
  await db.collab.upsertDecision(decision);
  const actionType =
    body.decision === "reject"
      ? "restaurant-rejected"
      : body.decision === "prefer"
        ? "restaurant-preferred"
        : body.decision === "dislike"
          ? "restaurant-disliked"
          : body.decision === "approve"
            ? "restaurant-approved"
            : "restaurant-decision-changed";
  const action = newAction({
    eventId,
    restaurantId,
    actorUserId: identity.userId,
    type: previous ? "restaurant-decision-changed" : actionType,
    visibility: body.visibility,
    payload: { decision: body.decision, reasonCategory: body.visibility === "event" ? body.reasonCategory : undefined }
  });
  await db.collab.insertAction(action);
  collabMetric(
    body.decision === "reject"
      ? "restaurant_rejected"
      : body.decision === "prefer"
        ? "restaurant_preferred"
        : body.decision === "dislike"
          ? "restaurant_disliked"
          : "restaurant_decision_changed"
  );
  const restaurantName = snapshot?.candidates.find((item) => item.id === restaurantId)?.name ?? "That restaurant";
  if (body.decision === "reject") {
    const text =
      body.visibility === "private"
        ? publicRejectionCopy(decision, restaurantName)
        : `${identity.displayName ?? "A participant"} rejected ${restaurantName}.${
            body.reasonCategory ? ` Reason: ${labelReason(body.reasonCategory)}.` : ""
          }`;
    const message = newChatMessage({
      eventId,
      sender: { type: "council" },
      messageType: "restaurant-decision",
      text,
      relatedRestaurantId: restaurantId,
      relatedActionId: action.id
    });
    await db.collab.insertChat(message);
    await notifyCouncil(c.env, eventId, { type: "chat", message });
  }
  await db.insertAudit({
    eventId,
    actorType: "user",
    actorId: identity.userId,
    action: "RESTAURANT_DECISION",
    resource: `${body.visibility}:${body.decision}`,
    decision: "ALLOW"
  });
  await requestReevaluate(c.env, eventId);
  return c.json({ decision: sanitizeDecisionForViewer(decision, identity.userId) });
});

collaborationRoutes.post("/:eventId/restaurants/:restaurantId/verifications", async (c) => {
  const { identity, db } = await memberContext(c, "collaboration.moderate");
  const eventId = c.req.param("eventId");
  const restaurantId = c.req.param("restaurantId");
  const snapshot = await db.getCouncilSnapshot(eventId);
  if (!restaurantInEvent(snapshot, restaurantId)) {
    throw new AppError(ErrorCodes.VALIDATION, "Restaurant is not a council candidate", 400);
  }
  const body = await c.req.json<{ requirementType?: string; requirementValue?: unknown; question?: string }>();
  const requirementType = body.requirementType?.trim() || "dietary";
  const task: VerificationTask = {
    id: createId("vtk"),
    eventId,
    restaurantId,
    requirementType,
    requirementValue: body.requirementValue,
    question: body.question?.trim() || suggestedVerificationQuestion(requirementType, body.requirementValue),
    status: "open",
    createdBy: { type: "user", userId: identity.userId },
    createdAt: nowIso()
  };
  await db.collab.upsertTask(task);
  const action = newAction({
    eventId,
    restaurantId,
    actorUserId: identity.userId,
    type: "verification-requested",
    visibility: "event",
    payload: { taskId: task.id, question: task.question }
  });
  await db.collab.insertAction(action);
  collabMetric("verification_tasks_created");
  await notifyCouncil(c.env, eventId, { type: "collaboration" });
  return c.json({ task }, 201);
});

collaborationRoutes.post("/:eventId/verifications/:verificationId/claim", async (c) => {
  const { identity, db } = await memberContext(c, "collaboration.act");
  const task = await db.collab.getTask(c.req.param("eventId"), c.req.param("verificationId"));
  if (!task) throw new AppError(ErrorCodes.NOT_FOUND, "Verification task not found", 404);
  const claimed = claimVerificationTask(task, identity.userId);
  await db.collab.upsertTask(claimed);
  const action = newAction({
    eventId: task.eventId,
    restaurantId: task.restaurantId,
    actorUserId: identity.userId,
    type: "verification-claimed",
    visibility: "event",
    payload: { taskId: task.id }
  });
  await db.collab.insertAction(action);
  const snapshot = await db.getCouncilSnapshot(task.eventId);
  const restaurantName = snapshot?.candidates.find((item) => item.id === task.restaurantId)?.name ?? "the restaurant";
  const message = newChatMessage({
    eventId: task.eventId,
    sender: { type: "council" },
    messageType: "verification-update",
    text: `📞 ${identity.displayName ?? "A participant"} is verifying ${String(task.requirementValue ?? task.requirementType)} at ${restaurantName}.`,
    relatedRestaurantId: task.restaurantId,
    relatedActionId: action.id
  });
  await db.collab.insertChat(message);
  collabMetric("verification_tasks_claimed");
  await notifyCouncil(c.env, task.eventId, { type: "chat", message });
  return c.json({ task: claimed });
});

collaborationRoutes.post("/:eventId/verifications/:verificationId/release", async (c) => {
  const { identity, db, loaded } = await memberContext(c, "collaboration.act");
  const task = await db.collab.getTask(c.req.param("eventId"), c.req.param("verificationId"));
  if (!task) throw new AppError(ErrorCodes.NOT_FOUND, "Verification task not found", 404);
  const isOwner = loaded.event.ownerId === identity.userId;
  const released = releaseVerificationTask(task, identity.userId, isOwner);
  await db.collab.upsertTask(released);
  await db.collab.insertAction(
    newAction({
      eventId: task.eventId,
      restaurantId: task.restaurantId,
      actorUserId: identity.userId,
      type: "verification-released",
      visibility: "event",
      payload: { taskId: task.id }
    })
  );
  collabMetric("verification_tasks_released");
  await notifyCouncil(c.env, task.eventId, { type: "collaboration" });
  return c.json({ task: released });
});

collaborationRoutes.post("/:eventId/verifications/:verificationId/complete", async (c) => {
  const { identity, db } = await memberContext(c, "collaboration.act");
  const task = await db.collab.getTask(c.req.param("eventId"), c.req.param("verificationId"));
  if (!task) throw new AppError(ErrorCodes.NOT_FOUND, "Verification task not found", 404);
  const allowed = await db.consumeRateLimit(`collab-act:${identity.userId}`, 80, 60 * 60 * 1000);
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many collaboration actions", 429);
  const body = CompleteVerificationInputSchema.parse(await c.req.json());
  const completed = completeVerificationTask(task, identity.userId);
  await db.collab.upsertTask(completed);
  const evidence: HumanEvidence = {
    id: createId("hev"),
    eventId: task.eventId,
    restaurantId: task.restaurantId,
    requirementType: task.requirementType,
    requirementValue: task.requirementValue,
    providedByUserId: identity.userId,
    method: body.method,
    result: body.result,
    notes: body.notes,
    verifiedAt: nowIso(),
    visibility: body.visibility ?? "event"
  };
  await db.collab.insertEvidence(evidence);
  const action = newAction({
    eventId: task.eventId,
    restaurantId: task.restaurantId,
    actorUserId: identity.userId,
    type: "verification-completed",
    visibility: evidence.visibility,
    payload: { taskId: task.id, result: body.result, method: body.method }
  });
  await db.collab.insertAction(action);
  const snapshot = await db.getCouncilSnapshot(task.eventId);
  const restaurantName = snapshot?.candidates.find((item) => item.id === task.restaurantId)?.name ?? "the restaurant";
  const resultLabel =
    body.result === "supports" ? "can accommodate it" : body.result === "contradicts" ? "cannot accommodate it" : "is still unclear";
  const message = newChatMessage({
    eventId: task.eventId,
    sender: { type: "council" },
    messageType: "verification-update",
    text:
      evidence.visibility === "event"
        ? `✓ ${String(task.requirementValue ?? task.requirementType)} at ${restaurantName} ${resultLabel} based on ${identity.displayName ?? "a participant"}'s ${body.method} verification.`
        : `A verification update was recorded for ${restaurantName}.`,
    relatedRestaurantId: task.restaurantId,
    relatedActionId: action.id
  });
  await db.collab.insertChat(message);
  collabMetric("verification_tasks_completed");
  collabMetric("human_evidence_added");
  await notifyCouncil(c.env, task.eventId, { type: "chat", message });
  await requestReevaluate(c.env, task.eventId);
  return c.json({ task: completed, evidence: sanitizeEvidenceForViewer(evidence, identity.userId) });
});

collaborationRoutes.post("/:eventId/preference-prompts/:promptId/respond", async (c) => {
  const { identity, db } = await memberContext(c, "collaboration.act");
  const prompt = await db.collab.getPrompt(c.req.param("eventId"), c.req.param("promptId"));
  if (!prompt || prompt.userId !== identity.userId) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Preference prompt not found", 404);
  }
  if (prompt.status !== "pending") {
    throw new AppError(ErrorCodes.CONFLICT, "This prompt was already answered", 409);
  }
  const body = await c.req.json<{ accepted?: boolean }>();
  const accepted = Boolean(body.accepted);
  const next = { ...prompt, status: accepted ? "accepted" as const : "declined" as const, resolvedAt: nowIso() };
  await db.collab.upsertPrompt(next);
  await db.collab.insertAction(
    newAction({
      eventId: prompt.eventId,
      actorUserId: identity.userId,
      type: accepted ? "preference-confirmed" : "preference-declined",
      visibility: prompt.visibility === "PRIVATE" ? "private" : "event",
      payload: { promptId: prompt.id, category: prompt.category }
    })
  );
  collabMetric(accepted ? "preference_confirmation_accepted" : "preference_confirmation_declined");
  if (accepted) {
    const now = nowIso();
    const preference = {
      id: createId("prf"),
      eventId: prompt.eventId,
      userId: identity.userId,
      category: prompt.category as PreferenceCategory,
      visibility: prompt.visibility,
      priority: prompt.priority,
      value: prompt.visibility === "PUBLIC" ? prompt.value : undefined,
      createdAt: now,
      updatedAt: now
    };
    await db.insertPreference(preference);
    if (prompt.visibility === "PRIVATE") {
      const { D1PreferenceVault } = await import("../services/preference-vault.ts");
      const vault = new D1PreferenceVault(db);
      await vault.upsertPrivate(createUserPrincipal(identity.userId), {
        preference,
        structuredValue: prompt.value
      });
    }
    await requestReevaluate(c.env, prompt.eventId, { refreshConstraints: true });
  }
  return c.json({ prompt: next });
});
