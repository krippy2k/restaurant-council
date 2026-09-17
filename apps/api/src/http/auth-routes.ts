import { Hono } from "hono";
import { AppError, ErrorCodes } from "@rc/shared";
import type { Env } from "../env.ts";
import {
  clearSession,
  issueSession,
  requireUser,
  type AppVariables
} from "./session.ts";
import { acceptInvitation } from "../services/invitations.ts";

export const authRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

authRoutes.post("/dev-signin", async (c) => {
  const body = await c.req.json<{ email?: string; displayName?: string }>();
  const email = body.email?.trim().toLowerCase();
  const displayName = body.displayName?.trim();
  if (!email || !email.includes("@")) {
    throw new AppError(ErrorCodes.VALIDATION, "A valid email is required", 400);
  }
  const db = c.get("db");
  let user = await db.getUserByEmail(email);
  if (!user) {
    if (!displayName) {
      return c.json({ needsDisplayName: true, email });
    }
    user = await db.createUser({ email, displayName });
  } else if (!user.displayName) {
    if (!displayName) {
      return c.json({ needsDisplayName: true, email });
    }
    user = (await db.updateUserDisplayName(user.id, displayName)) ?? user;
  }
  await issueSession(c, user.id);
  await db.insertAudit({
    actorType: "user",
    actorId: user.id,
    action: "USER_AUTHENTICATED",
    decision: "ALLOW"
  });
  return c.json({ user });
});

authRoutes.post("/signout", async (c) => {
  await clearSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const identity = requireUser(c);
  const user = await c.get("db").getUser(identity.userId);
  return c.json({ user });
});

authRoutes.get("/dev-identities", async (c) => {
  const identity = requireUser(c);
  const db = c.get("db");
  const current = await db.getUser(identity.userId);
  const people = new Map<string, { email: string; displayName?: string }>();
  const add = (email?: string, displayName?: string) => {
    const key = email?.trim().toLowerCase();
    if (!key || !key.includes("@")) return;
    const prior = people.get(key);
    people.set(key, {
      email: key,
      displayName: displayName?.trim() || prior?.displayName
    });
  };
  add(current?.email, current?.displayName);
  for (const invitation of await db.listInvitationsSentBy(identity.userId)) {
    const existing = await db.getUserByEmail(invitation.destination);
    add(invitation.destination, existing?.displayName);
  }
  for (const member of await db.listEventMemberUsers(identity.userId)) {
    add(member.email, member.displayName);
  }
  return c.json({ people: [...people.values()] });
});

authRoutes.get("/invitations", async (c) => {
  const identity = requireUser(c);
  const db = c.get("db");
  const user = await db.getUser(identity.userId);
  if (!user?.email) return c.json({ invitations: [] });
  const pending = await db.listPendingInvitationsByEmail(user.email);
  const invitations = [];
  for (const invitation of pending) {
    const event = await db.getEvent(invitation.eventId);
    const inviter = await db.getUser(invitation.invitedBy);
    invitations.push({
      id: invitation.id,
      eventId: invitation.eventId,
      eventName: event?.name ?? "an event",
      date: event?.date,
      locationLabel: event?.locationLabel,
      inviterName: inviter?.displayName ?? inviter?.email ?? "A host",
      createdAt: invitation.createdAt
    });
  }
  return c.json({ invitations });
});

authRoutes.post("/invitations/:id/accept", async (c) => {
  const identity = requireUser(c);
  const db = c.get("db");
  const invitation = await db.getInvitation(c.req.param("id"));
  if (!invitation) {
    throw new AppError(ErrorCodes.INVITATION_INVALID, "Invitation not found", 404);
  }
  const user = await db.getUser(identity.userId);
  if (!user?.email || user.email.toLowerCase() !== invitation.destination.toLowerCase()) {
    throw new AppError(ErrorCodes.FORBIDDEN, "This invitation is for a different email", 403);
  }
  const eventId = await acceptInvitation(db, invitation, identity.userId);
  return c.json({ eventId });
});

