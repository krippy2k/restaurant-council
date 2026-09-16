import type { Principal } from "@rc/auth";
import type { Database } from "../db/database.ts";

export function actorFrom(principal: Principal): { actorType: string; actorId: string } {
  switch (principal.type) {
    case "user":
      return { actorType: "user", actorId: principal.userId };
    case "personal_agent":
      return { actorType: "personal_agent", actorId: principal.agentId };
    case "negotiator":
      return { actorType: "negotiator", actorId: principal.agentId };
    case "system":
      return { actorType: "system", actorId: principal.service };
  }
}

export async function writeAudit(
  db: Database,
  input: {
    principal: Principal;
    action: string;
    resource?: string;
    decision: string;
    reason?: string;
    eventId?: string;
  }
): Promise<void> {
  const actor = actorFrom(input.principal);
  await db.insertAudit({
    eventId: input.eventId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: input.action,
    resource: input.resource,
    decision: input.decision,
    reason: input.reason
  });
}
