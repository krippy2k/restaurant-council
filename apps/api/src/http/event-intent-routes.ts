import { Hono } from "hono";
import {
  EventCreationAgent,
  LlmEventIntentParser,
  MockEventIntentParser
} from "@rc/agents";
import {
  EVENT_INTENT_PARSER_VERSION,
  EventCreationIntentSchema,
  EventParserContextSchema,
  type EventCreationIntent
} from "@rc/protocol";
import { AppError, ErrorCodes } from "@rc/shared";
import { resolveLocationQuery } from "@rc/tools";
import { runtimeFromEnv } from "../ai.ts";
import type { Env } from "../env.ts";
import { createLocationResolver } from "../restaurants.ts";
import { requireUser, type AppVariables } from "./session.ts";
import {
  applyCreatorPreferences,
  assertReadyToCreate,
  persistNewEvent,
  sendIntentInvitations
} from "./event-create.ts";

export const eventIntentRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function parserContext(body: { timezone?: string }): ReturnType<typeof EventParserContextSchema.parse> {
  return EventParserContextSchema.parse({
    currentDateTime: new Date().toISOString(),
    timezone: body.timezone?.trim() || "America/New_York"
  });
}

function createEventAgent(env: Env): EventCreationAgent {
  const runtime = runtimeFromEnv(env);
  const parser = runtime ? new LlmEventIntentParser(runtime) : new MockEventIntentParser();
  const resolver = createLocationResolver(env);
  return new EventCreationAgent(parser, (query) => resolveLocationQuery(resolver, query));
}

function parseIntent(input: unknown): EventCreationIntent {
  const parsed = EventCreationIntentSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION, "Invalid event intent", 400);
  }
  return parsed.data;
}

function nlMetric(name: string, extra?: Record<string, unknown>): void {
  console.info(JSON.stringify({ metric: name, parser: EVENT_INTENT_PARSER_VERSION, ...extra }));
}

eventIntentRoutes.post("/interpret", async (c) => {
  const identity = requireUser(c);
  const allowed = await c.get("db").consumeRateLimit(`event-nl:${identity.userId}`, 20, 60 * 60 * 1000);
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many event interpretations", 429);
  const body = await c.req.json<{ text?: string; timezone?: string }>();
  const text = body.text?.trim() ?? "";
  if (!text) throw new AppError(ErrorCodes.VALIDATION, "Describe the event first", 400);
  const started = Date.now();
  nlMetric("event_nl_creation_started");
  const context = parserContext(body);
  const result = await createEventAgent(c.env).interpret(text, context);
  nlMetric(result.fallbackToForm ? "event_nl_parse_failure" : "event_nl_parse_success", {
    durationMs: Date.now() - started,
    followup: result.questions.length > 0,
    ambiguous: result.intent.ambiguities.length > 0,
    ready: result.readyToCreate
  });
  if (result.questions.length) nlMetric("event_nl_followup_required");
  if (result.intent.ambiguities.some((item) => item.field === "location")) {
    nlMetric("event_nl_location_ambiguous");
  }
  if (result.readyToCreate) nlMetric("event_nl_confirmation_shown");
  if (result.fallbackToForm) nlMetric("event_nl_fallback_to_form");
  return c.json({ result, parserVersion: EVENT_INTENT_PARSER_VERSION });
});

eventIntentRoutes.post("/interpret/modify", async (c) => {
  const identity = requireUser(c);
  const allowed = await c.get("db").consumeRateLimit(`event-nl:${identity.userId}`, 20, 60 * 60 * 1000);
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many event interpretations", 429);
  const body = await c.req.json<{
    text?: string;
    timezone?: string;
    intent?: unknown;
  }>();
  const text = body.text?.trim() ?? "";
  if (!text) throw new AppError(ErrorCodes.VALIDATION, "Describe the change first", 400);
  const current = parseIntent(body.intent);
  const result = await createEventAgent(c.env).modify(current, text, parserContext(body));
  nlMetric("event_nl_modified", { ready: result.readyToCreate });
  return c.json({ result, parserVersion: EVENT_INTENT_PARSER_VERSION });
});

eventIntentRoutes.post("/from-intent", async (c) => {
  const identity = requireUser(c);
  const allowed = await c.get("db").consumeRateLimit(`event-nl-create:${identity.userId}`, 10, 60 * 60 * 1000);
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many event creations", 429);
  const body = await c.req.json<{ intent?: unknown; timezone?: string }>();
  const intent = parseIntent(body.intent);
  const result = await createEventAgent(c.env).prepare(intent, parserContext(body));
  assertReadyToCreate(result);
  const command = result.command!;
  const event = await persistNewEvent(c.get("db"), identity, {
    name: command.name,
    date: command.date,
    timezone: command.timezone ?? parserContext(body).timezone,
    searchArea: command.searchArea,
    locationLabel: command.locationLabel,
    restaurantSearchPolicy: command.restaurantSearchPolicy
  });
  await applyCreatorPreferences(c.get("db"), identity, event, result.intent);
  const invitations = await sendIntentInvitations(
    c.get("db"),
    identity,
    event,
    result.intent
  );
  await c.get("db").insertAudit({
    eventId: event.id,
    actorType: "user",
    actorId: identity.userId,
    action: "EVENT_NL_CONFIRMED",
    resource: EVENT_INTENT_PARSER_VERSION,
    decision: "ALLOW"
  });
  nlMetric("event_nl_confirmed");
  return c.json({ event, invitations }, 201);
});
