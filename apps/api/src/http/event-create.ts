import { assertAuthorized, createUserPrincipal, type Identity } from "@rc/auth";
import type { Event, EventSearchArea, Preference, PreferenceCategory } from "@rc/domain";
import { preferencesFromIntent, type EventCreationResult } from "@rc/agents";
import type { EventCreationIntent } from "@rc/protocol";
import { AppError, ErrorCodes, addHours, createId, hashToken, nowIso, randomToken } from "@rc/shared";
import type { Database } from "../db/database.ts";
import { D1PreferenceVault } from "../services/preference-vault.ts";
import { DevInvitationSender } from "../services/invitations.ts";

export async function persistNewEvent(
  db: Database,
  identity: Identity,
  input: {
    name: string;
    date?: string;
    searchArea?: EventSearchArea;
    locationLabel?: string;
  }
): Promise<Event> {
  const now = nowIso();
  const event: Event = {
    id: createId("evt"),
    ownerId: identity.userId,
    name: input.name,
    date: input.date,
    locationLabel: input.searchArea?.displayName ?? input.locationLabel,
    location: input.searchArea
      ? { latitude: input.searchArea.latitude, longitude: input.searchArea.longitude }
      : undefined,
    searchArea: input.searchArea,
    status: "collecting_preferences",
    createdAt: now,
    updatedAt: now
  };
  await db.createEvent(event);
  await db.upsertMember({
    eventId: event.id,
    userId: identity.userId,
    role: "owner",
    status: "joined",
    joinedAt: now
  });
  await db.insertAudit({
    eventId: event.id,
    actorType: "user",
    actorId: identity.userId,
    action: "EVENT_CREATED",
    decision: "ALLOW"
  });
  return event;
}

export async function applyCreatorPreferences(
  db: Database,
  identity: Identity,
  event: Event,
  intent: EventCreationIntent
): Promise<void> {
  const drafts = preferencesFromIntent(intent);
  const vault = new D1PreferenceVault(db);
  for (const draft of drafts) {
    const now = nowIso();
    const preference: Preference = {
      id: createId("prf"),
      eventId: event.id,
      userId: identity.userId,
      category: draft.category as PreferenceCategory,
      visibility: draft.visibility,
      priority: draft.priority,
      value: draft.visibility === "PUBLIC" ? draft.value : undefined,
      createdAt: now,
      updatedAt: now
    };
    assertAuthorized({
      principal: createUserPrincipal(identity.userId),
      action: "preference.own.write",
      resource: {
        type: "preference",
        userId: identity.userId,
        eventId: event.id,
        visibility: draft.visibility
      }
    });
    await db.insertPreference(preference);
    if (draft.visibility === "PRIVATE") {
      await vault.upsertPrivate(createUserPrincipal(identity.userId), {
        preference,
        structuredValue: draft.value
      });
    }
  }
}

export async function sendIntentInvitations(
  db: Database,
  identity: Identity,
  event: Event,
  intent: EventCreationIntent,
  appOrigin: string,
  environment: string
): Promise<Array<{ email: string; devInviteUrl?: string }>> {
  const sent: Array<{ email: string; devInviteUrl?: string }> = [];
  const sender = new DevInvitationSender();
  const inviter = await db.getUser(identity.userId);
  for (const invitee of intent.invitees ?? []) {
    const email = invitee.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    const allowed = await db.consumeRateLimit(`invite:${identity.userId}`, 10, 60 * 60 * 1000);
    if (!allowed) {
      throw new AppError(ErrorCodes.RATE_LIMITED, "Too many invitations", 429);
    }
    const token = randomToken(32);
    await db.createInvitation({
      id: createId("inv"),
      eventId: event.id,
      invitedBy: identity.userId,
      type: "email",
      destination: email,
      tokenHash: await hashToken(token),
      expiresAt: addHours(nowIso(), 24 * 7),
      createdAt: nowIso()
    });
    const url = `${appOrigin}/join?invite=${token}`;
    await sender.sendEmail({
      destination: email,
      eventName: event.name,
      inviterName: inviter?.displayName ?? "A host",
      url
    });
    await db.insertAudit({
      eventId: event.id,
      actorType: "user",
      actorId: identity.userId,
      action: "INVITATION_CREATED",
      resource: "email",
      decision: "ALLOW"
    });
    sent.push({
      email,
      devInviteUrl: environment === "development" ? url : undefined
    });
  }
  return sent;
}

export function assertReadyToCreate(result: EventCreationResult): void {
  if (!result.readyToCreate || !result.command) {
    throw new AppError(
      ErrorCodes.VALIDATION,
      result.questions[0] ?? result.errors[0]?.message ?? "Event is not ready to create",
      400
    );
  }
}
