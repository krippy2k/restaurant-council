import { createChatAgentRegistry } from "@rc/agents";
import type { AgentInvocation, EventChatMessage, ToolExecutionContext } from "@rc/protocol";
import { createId, nowIso } from "@rc/shared";
import {
  createMockResearchTools,
  createResearchToolRegistry,
  createResearchTools,
  type ResearchRestaurant
} from "@rc/tools";
import { runtimeFromEnv } from "../ai.ts";
import type { Database } from "../db/database.ts";
import { newChatMessage } from "../db/collaboration.ts";
import type { Env } from "../env.ts";
import { notifyCouncil } from "../http/collab-notify.ts";
import { restaurantProviderName } from "../restaurants.ts";

function toResearchRestaurant(candidate: {
  id: string;
  name: string;
  address?: string;
  website?: string;
  phone?: string;
  outdoorSeating?: boolean;
  priceLevel?: number;
  rating?: number;
  reviewCount?: number;
  reviews?: ResearchRestaurant["reviews"];
  dietaryAssessments?: ResearchRestaurant["dietaryAssessments"];
  latitude: number;
  longitude: number;
  hours?: string;
  hoursWeekdayText?: string[];
  openingHours?: ResearchRestaurant["openingHours"];
}): ResearchRestaurant {
  return {
    id: candidate.id,
    name: candidate.name,
    address: candidate.address,
    website: candidate.website,
    phone: candidate.phone,
    outdoorSeating: candidate.outdoorSeating,
    priceLevel: candidate.priceLevel,
    rating: candidate.rating,
    reviewCount: candidate.reviewCount,
    reviews: candidate.reviews,
    dietaryAssessments: candidate.dietaryAssessments,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    hours: candidate.hours,
    hoursWeekdayText: candidate.hoursWeekdayText,
    openingHours: candidate.openingHours
  };
}

export function createEventResearchRegistry(env: Env, db: Database, eventId: string) {
  const getRestaurant = async (restaurantId: string, context: ToolExecutionContext) => {
    if (!context.authorized || context.eventId !== eventId) return null;
    const snapshot = await db.getCouncilSnapshot(eventId);
    const candidate = snapshot?.candidates.find((item) => item.id === restaurantId);
    return candidate ? toResearchRestaurant(candidate) : null;
  };
  const deps = {
    getRestaurant,
    fetchImpl: fetch,
    cache: db.research
  };
  const tools =
    restaurantProviderName(env) === "mock" ? createMockResearchTools(deps) : createResearchTools(deps);
  return createChatAgentRegistry(createResearchToolRegistry(tools), runtimeFromEnv(env));
}

export async function executeAgentInvocation(input: {
  env: Env;
  db: Database;
  invocationId: string;
  eventId: string;
}): Promise<AgentInvocation> {
  const invocation = await input.db.research.getInvocation(input.eventId, input.invocationId);
  if (!invocation) throw new Error("Agent invocation not found");
  const running: AgentInvocation = {
    ...invocation,
    status: "running",
    startedAt: invocation.startedAt ?? nowIso()
  };
  await input.db.research.updateInvocation(running);

  try {
    const snapshot = await input.db.getCouncilSnapshot(input.eventId);
    const event = await input.db.getEvent(input.eventId);
    const chat = await input.db.collab.listChat(input.eventId);
    const source = chat.find((item) => item.id === invocation.sourceMessageId);
    const registry = createEventResearchRegistry(input.env, input.db, input.eventId);
    const agent = registry.get(invocation.agentId);
    if (!agent) throw new Error("Unknown agent");

    const previous = chat
      .filter((item) => item.messageType === "agent-request" || item.sender.type === "agent")
      .slice(-6)
      .map((item) => ({
        query: item.messageType === "agent-request" ? item.text ?? "" : "",
        restaurantIds: item.relatedRestaurantIds ?? (item.relatedRestaurantId ? [item.relatedRestaurantId] : []),
        answer: item.sender.type === "agent" ? item.text ?? "" : ""
      }))
      .filter((item) => item.query || item.answer);

    const publicRequirements = (snapshot?.constraints ?? [])
      .filter((constraint) => constraint.visibility === "PUBLIC")
      .map((constraint) => `${constraint.type}`);

    const result = await agent.execute(
      {
        mention: { agentId: agent.id, mention: agent.mention, query: invocation.query },
        sourceMessageId: invocation.sourceMessageId,
        invocationId: invocation.id
      },
      {
        eventId: input.eventId,
        requestingUserId: invocation.userId,
        visibility: invocation.visibility,
        event: {
          startsAt: event?.date,
          locationLabel: event?.locationLabel,
          publicRequirements
        },
        candidateRestaurants: snapshot?.candidates ?? [],
        finalistIds: snapshot?.recommendations.filter((item) => !item.rejected).map((item) => item.candidate.id),
        selectedRestaurantId: source?.relatedRestaurantId,
        recentConversation: chat.slice(-12).map((item) => ({
          senderType: item.sender.type,
          text: item.text,
          relatedRestaurantIds: item.relatedRestaurantIds ?? (item.relatedRestaurantId ? [item.relatedRestaurantId] : [])
        })),
        previousAgentInteractions: previous
      }
    );

    const completed: AgentInvocation = {
      ...running,
      status: "completed",
      completedAt: nowIso(),
      resolvedRestaurantIds: result.answer.restaurantIds,
      answer: result.answer,
      errorCode: undefined,
      errorMessage: undefined
    };
    console.info(JSON.stringify({ metric: "agent_invocations_completed", status: "completed" }));

    if (invocation.visibility === "event") {
      const response = await upsertAgentResponse(input.db, completed, result.answer.answer, {
        cards: result.answer.cards,
        offerVerification: result.answer.offerVerification,
        restaurantIds: result.answer.restaurantIds
      });
      completed.responseMessageId = response.id;
      await input.db.research.updateInvocation(completed);
      await notifyCouncil(input.env, input.eventId, { type: "chat", message: response });
    } else {
      await input.db.research.updateInvocation(completed);
    }
    return completed;
  } catch (error) {
    const failed: AgentInvocation = {
      ...running,
      status: "failed",
      completedAt: nowIso(),
      errorCode: "AGENT_FAILED",
      errorMessage: error instanceof Error ? error.message.slice(0, 240) : "Agent failed"
    };
    console.error("agent invocation failed", error);
    console.info(JSON.stringify({ metric: "agent_invocations_completed", status: "failed" }));
    if (invocation.visibility === "event") {
      const response = await upsertAgentResponse(input.db, failed, "I couldn't finish that research. You can retry the request.", {
        restaurantIds: []
      });
      failed.responseMessageId = response.id;
      await input.db.research.updateInvocation(failed);
      await notifyCouncil(input.env, input.eventId, { type: "chat", message: response });
    } else {
      await input.db.research.updateInvocation(failed);
    }
    return failed;
  }
}

async function upsertAgentResponse(
  db: Database,
  invocation: AgentInvocation,
  text: string,
  extra: {
    cards?: EventChatMessage["cards"];
    offerVerification?: EventChatMessage["offerVerification"];
    restaurantIds: string[];
  }
): Promise<EventChatMessage> {
  const existing = invocation.responseMessageId
    ? await db.collab.getChat(invocation.eventId, invocation.responseMessageId)
    : null;
  const message: EventChatMessage = {
    ...(existing ??
      newChatMessage({
        eventId: invocation.eventId,
        sender: { type: "agent", agentId: invocation.agentId },
        messageType: "agent-response",
        relatedAgentInvocationId: invocation.id
      })),
    text,
    messageType: "agent-response",
    relatedRestaurantIds: extra.restaurantIds,
    relatedRestaurantId: extra.restaurantIds[0],
    relatedAgentInvocationId: invocation.id,
    cards: extra.cards,
    offerVerification: extra.offerVerification,
    editedAt: existing ? nowIso() : undefined
  };
  if (existing) await db.collab.updateChat(message);
  else await db.collab.insertChat(message);
  return message;
}

export async function startAgentFromChat(input: {
  env: Env;
  db: Database;
  eventId: string;
  userId: string;
  source: EventChatMessage;
  query: string;
  agentId: string;
  visibility?: AgentInvocation["visibility"];
}): Promise<{ invocation: AgentInvocation; progress?: EventChatMessage }> {
  const invocation: AgentInvocation = {
    id: createId("ainv"),
    eventId: input.eventId,
    userId: input.userId,
    agentId: input.agentId,
    sourceMessageId: input.source.id,
    visibility: input.visibility ?? "event",
    status: "queued",
    query: input.query
  };
  let progress: EventChatMessage | undefined;
  if (invocation.visibility === "event") {
    progress = newChatMessage({
      eventId: input.eventId,
      sender: { type: "agent", agentId: input.agentId },
      messageType: "agent-response",
      text: "@agent is checking…",
      relatedAgentInvocationId: invocation.id,
      relatedRestaurantId: input.source.relatedRestaurantId
    });
    invocation.responseMessageId = progress.id;
    await input.db.collab.insertChat(progress);
  }
  await input.db.research.insertInvocation(invocation);
  return { invocation, progress };
}

export function scheduleAgent(c: { executionCtx?: { waitUntil(promise: Promise<unknown>): void } }, work: Promise<unknown>): void {
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(work.catch((error) => console.error(error)));
    return;
  }
  void work.catch((error) => console.error(error));
}
