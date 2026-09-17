import { Hono } from "hono";
import { AppError, ErrorCodes, hashToken, isExpired } from "@rc/shared";
import type { Env } from "../env.ts";
import { requireUser, type AppVariables } from "./session.ts";
import { acceptInvitation } from "../services/invitations.ts";

export const inviteRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

inviteRoutes.get("/:token", async (c) => {
  const db = c.get("db");
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const allowed = await db.consumeRateLimit(`invite-validate:${ip}`, 20, 15 * 60 * 1000);
  if (!allowed) {
    throw new AppError(ErrorCodes.RATE_LIMITED, "Too many attempts", 429);
  }
  const token = c.req.param("token");
  const invitation = await db.getInvitationByTokenHash(await hashToken(token));
  if (!invitation) {
    throw new AppError(ErrorCodes.INVITATION_INVALID, "Invitation not found", 404);
  }
  if (invitation.acceptedAt) {
    throw new AppError(ErrorCodes.INVITATION_USED, "Invitation already used", 400);
  }
  if (isExpired(invitation.expiresAt)) {
    throw new AppError(ErrorCodes.INVITATION_EXPIRED, "Invitation expired", 400);
  }
  const event = await db.getEvent(invitation.eventId);
  const inviter = await db.getUser(invitation.invitedBy);
  return c.json({
    event: {
      name: event?.name,
      date: event?.date,
      locationLabel: event?.locationLabel
    },
    inviterName: inviter?.displayName ?? "A host"
  });
});

inviteRoutes.post("/:token/accept", async (c) => {
  const identity = requireUser(c);
  const db = c.get("db");
  const invitation = await db.getInvitationByTokenHash(await hashToken(c.req.param("token")));
  if (!invitation) {
    throw new AppError(ErrorCodes.INVITATION_INVALID, "Invitation not found", 404);
  }
  const eventId = await acceptInvitation(db, invitation, identity.userId);
  return c.json({ eventId });
});
