import { assertAuthorized, createUserPrincipal } from "@rc/auth";
import { AppError, ErrorCodes } from "@rc/shared";
import type { Database } from "../db/database.ts";

export async function loadEventResource(db: Database, eventId: string) {
  const event = await db.getEvent(eventId);
  if (!event) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Event not found", 404);
  }
  const members = await db.listMembers(eventId);
  return {
    event,
    members,
    resource: {
      type: "event" as const,
      eventId: event.id,
      ownerId: event.ownerId,
      memberIds: members.map((member) => member.userId)
    }
  };
}

export async function assertEventRead(db: Database, userId: string, eventId: string) {
  const loaded = await loadEventResource(db, eventId);
  assertAuthorized({
    principal: createUserPrincipal(userId),
    action: "event.read",
    resource: loaded.resource
  });
  return loaded;
}
