import { Hono } from "hono";
import {
  authorize,
  createNegotiatorPrincipal,
  createPersonalAgentPrincipal,
  createUserPrincipal
} from "@rc/auth";
import { sanitizeCouncilSnapshotForClients } from "@rc/protocol";
import { AppError, ErrorCodes } from "@rc/shared";
import type { Env } from "../env.ts";
import { assertEventRead, loadEventResource } from "./event-access.ts";
import { requireUser, type AppVariables } from "./session.ts";
import { writeAudit } from "../services/audit.ts";
import { runtimeFromEnv } from "../ai.ts";

export const councilRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

councilRoutes.get("/:eventId/council", async (c) => {
  const identity = requireUser(c);
  await assertEventRead(c.get("db"), identity.userId, c.req.param("eventId"));
  const snapshot = await c.get("db").getCouncilSnapshot(c.req.param("eventId"));
  return c.json({
    snapshot: snapshot ? sanitizeCouncilSnapshotForClients(snapshot) : null
  });
});

councilRoutes.post("/:eventId/council/start", async (c) => {
  const identity = requireUser(c);
  const loaded = await loadEventResource(c.get("db"), c.req.param("eventId"));
  const decision = authorize({
    principal: createUserPrincipal(identity.userId),
    action: "event.start_council",
    resource: loaded.resource
  });
  if (!decision.allowed) {
    await writeAudit(c.get("db"), {
      principal: createUserPrincipal(identity.userId),
      action: "COUNCIL_STARTED",
      eventId: loaded.event.id,
      decision: decision.code,
      reason: decision.reason
    });
    throw new AppError(ErrorCodes.FORBIDDEN, decision.reason, 403);
  }
  if (!runtimeFromEnv(c.env)) {
    throw new AppError(
      ErrorCodes.AGENTS_NOT_CONFIGURED,
      "Council agents require OPENAI_API_KEY. Add it to .dev.vars at the repo root and restart the API.",
      503
    );
  }
  const id = c.env.COUNCIL.idFromName(loaded.event.id);
  const stub = c.env.COUNCIL.get(id);
  const response = await stub.fetch("https://council/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId: loaded.event.id })
  });
  const body = await response.json();
  return c.json(body, response.status as never);
});

councilRoutes.get("/:eventId/council/ws", async (c) => {
  const identity = requireUser(c);
  await assertEventRead(c.get("db"), identity.userId, c.req.param("eventId"));
  const id = c.env.COUNCIL.idFromName(c.req.param("eventId"));
  const stub = c.env.COUNCIL.get(id);
  return stub.fetch(c.req.raw);
});

councilRoutes.get("/:eventId/authorization-demo", async (c) => {
  const identity = requireUser(c);
  const loaded = await assertEventRead(
    c.get("db"),
    identity.userId,
    c.req.param("eventId")
  );
  const other = loaded.members.find((member) => member.userId !== identity.userId);
  const targetUserId = other?.userId ?? "usr_nonexistent_target";
  const attempts = [
    {
      name: "Cross-user preference access",
      request: {
        principal: createUserPrincipal(identity.userId),
        action: "preference.private.read" as const,
        resource: {
          type: "preference" as const,
          userId: targetUserId,
          eventId: loaded.event.id,
          visibility: "PRIVATE" as const
        }
      }
    },
    {
      name: "Cross-agent preference access",
      request: {
        principal: createPersonalAgentPrincipal({
          userId: identity.userId,
          eventId: loaded.event.id
        }),
        action: "preference.private.read" as const,
        resource: {
          type: "preference" as const,
          userId: targetUserId,
          eventId: loaded.event.id,
          visibility: "PRIVATE" as const
        }
      }
    },
    {
      name: "Negotiator preference access",
      request: {
        principal: createNegotiatorPrincipal(loaded.event.id),
        action: "preference.private.read" as const,
        resource: {
          type: "preference" as const,
          userId: targetUserId,
          eventId: loaded.event.id,
          visibility: "PRIVATE" as const
        }
      }
    },
    {
      name: "Event isolation",
      request: {
        principal: createUserPrincipal(identity.userId),
        action: "event.read" as const,
        resource: {
          type: "event" as const,
          eventId: "evt_other",
          ownerId: "usr_other",
          memberIds: []
        }
      }
    }
  ];

  const results = [];
  for (const attempt of attempts) {
    const decision = authorize(attempt.request);
    await writeAudit(c.get("db"), {
      principal: attempt.request.principal,
      action: "TOOL_DENIED",
      eventId: loaded.event.id,
      resource: attempt.name,
      decision: decision.code,
      reason: decision.reason
    });
    results.push({
      name: attempt.name,
      allowed: decision.allowed,
      code: decision.code,
      reason: decision.reason
    });
  }

  return c.json({ results });
});
