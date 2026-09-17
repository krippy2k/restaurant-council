import type { Event, Invitation } from "@rc/domain";
import type { Identity } from "@rc/auth";
import { AppError, ErrorCodes, addHours, createId, hashToken, isExpired, nowIso, randomToken } from "@rc/shared";
import type { Database } from "../db/database.ts";

export interface EmailInvitation {
  destination: string;
  eventName: string;
  inviterName: string;
  url?: string;
}

export interface SmsInvitation {
  destination: string;
  eventName: string;
  url?: string;
}

export interface InvitationSender {
  sendEmail(invitation: EmailInvitation): Promise<void>;
  sendSms(invitation: SmsInvitation): Promise<void>;
}

export class DevInvitationSender implements InvitationSender {
  readonly sent: EmailInvitation[] = [];

  async sendEmail(invitation: EmailInvitation): Promise<void> {
    this.sent.push(invitation);
    console.log(
      `\nDEV INVITATION\n${invitation.destination} is invited to ${invitation.eventName}. They can accept after signing in with that email.\n`
    );
  }

  async sendSms(invitation: SmsInvitation): Promise<void> {
    console.log(
      `\nDEV SMS INVITATION\n${invitation.destination} is invited to ${invitation.eventName}.\n`
    );
  }
}

export async function createEmailInvitation(
  db: Database,
  input: {
    identity: Identity;
    event: Event;
    email: string;
  }
): Promise<Invitation | null> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new AppError(ErrorCodes.VALIDATION, "Invitation email is required", 400);
  }
  const existing = await db.getInvitationByEventEmail(input.event.id, email);
  if (existing) return existing;
  const invitation: Invitation = {
    id: createId("inv"),
    eventId: input.event.id,
    invitedBy: input.identity.userId,
    type: "email",
    destination: email,
    tokenHash: await hashToken(randomToken(32)),
    expiresAt: addHours(nowIso(), 24 * 7),
    createdAt: nowIso()
  };
  await db.createInvitation(invitation);
  const sender = new DevInvitationSender();
  const inviter = await db.getUser(input.identity.userId);
  await sender.sendEmail({
    destination: email,
    eventName: input.event.name,
    inviterName: inviter?.displayName ?? "A host"
  });
  await db.insertAudit({
    eventId: input.event.id,
    actorType: "user",
    actorId: input.identity.userId,
    action: "INVITATION_CREATED",
    resource: "email",
    decision: "ALLOW"
  });
  return invitation;
}

export async function acceptInvitation(
  db: Database,
  invitation: Invitation,
  userId: string
): Promise<string> {
  if (invitation.acceptedAt) {
    throw new AppError(ErrorCodes.INVITATION_USED, "Invitation already used", 400);
  }
  if (isExpired(invitation.expiresAt)) {
    throw new AppError(ErrorCodes.INVITATION_EXPIRED, "Invitation expired", 400);
  }
  const now = nowIso();
  await db.markInvitationAccepted(invitation.id, now);
  await db.upsertMember({
    eventId: invitation.eventId,
    userId,
    role: "member",
    status: "joined",
    joinedAt: now
  });
  await db.insertAudit({
    eventId: invitation.eventId,
    actorType: "user",
    actorId: userId,
    action: "INVITATION_ACCEPTED",
    decision: "ALLOW"
  });
  return invitation.eventId;
}

export function publicInvitation(invitation: Invitation) {
  return {
    id: invitation.id,
    type: invitation.type,
    destination: invitation.destination,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt
  };
}
