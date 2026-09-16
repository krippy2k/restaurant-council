import { Hono } from "hono";
import { assertAuthorized, createUserPrincipal } from "@rc/auth";
import { sanitizePreferenceForViewer, textRequestsSecrecy, type Event, type EventSearchArea } from "@rc/domain";
import { interpretPreferenceNotes } from "@rc/agents";
import { AppError, ErrorCodes, addHours, createId, hashToken, nowIso, randomToken } from "@rc/shared";
import { clampRadiusMeters, milesToMeters } from "@rc/tools";
import type { Env } from "../env.ts";
import { assertEventRead, loadEventResource } from "./event-access.ts";
import { requireUser, type AppVariables } from "./session.ts";
import { persistNewEvent } from "./event-create.ts";
import { DevInvitationSender } from "../services/invitations.ts";
import { runtimeFromEnv } from "../ai.ts";

const CITY_PRESETS: Record<string, { latitude: number; longitude: number }> = {
  "New York": { latitude: 40.758, longitude: -73.9855 },
  "San Francisco": { latitude: 37.7749, longitude: -122.4194 },
  Chicago: { latitude: 41.8781, longitude: -87.6298 },
  Austin: { latitude: 30.2672, longitude: -97.7431 }
};

function searchAreaFromBody(body: {
  locationLabel?: string;
  latitude?: number;
  longitude?: number;
  radiusMiles?: number;
  radiusMeters?: number;
  searchArea?: EventSearchArea;
}): EventSearchArea | undefined {
  if (body.searchArea?.latitude != null && body.searchArea.longitude != null) {
    return {
      ...body.searchArea,
      displayName: body.searchArea.displayName || body.locationLabel || "Search area",
      radiusMeters: clampRadiusMeters(body.searchArea.radiusMeters)
    };
  }
  const preset = body.locationLabel ? CITY_PRESETS[body.locationLabel] : undefined;
  const latitude = body.latitude ?? preset?.latitude;
  const longitude = body.longitude ?? preset?.longitude;
  if (latitude == null || longitude == null) return undefined;
  const radiusMeters = clampRadiusMeters(
    body.radiusMeters ?? (body.radiusMiles != null ? milesToMeters(body.radiusMiles) : undefined)
  );
  return {
    displayName: body.locationLabel || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    latitude,
    longitude,
    radiusMeters,
    source: preset ? "city" : "coordinates"
  };
}

export const eventRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

eventRoutes.get("/", async (c) => {
  const identity = requireUser(c);
  const events = await c.get("db").listEventsForUser(identity.userId);
  return c.json({ events });
});

eventRoutes.post("/", async (c) => {
  const identity = requireUser(c);
  const body = await c.req.json<{
    name?: string;
    date?: string;
    locationLabel?: string;
    latitude?: number;
    longitude?: number;
    radiusMiles?: number;
    radiusMeters?: number;
    searchArea?: EventSearchArea;
  }>();
  const name = body.name?.trim();
  if (!name) {
    throw new AppError(ErrorCodes.VALIDATION, "Event name is required", 400);
  }
  const searchArea = searchAreaFromBody(body);
  const event = await persistNewEvent(c.get("db"), identity, {
    name,
    date: body.date,
    searchArea,
    locationLabel: body.locationLabel
  });
  return c.json({ event }, 201);
});

eventRoutes.get("/:eventId", async (c) => {
  const identity = requireUser(c);
  const { event, members } = await assertEventRead(
    c.get("db"),
    identity.userId,
    c.req.param("eventId")
  );
  const users = await Promise.all(members.map((member) => c.get("db").getUser(member.userId)));
  return c.json({
    event,
    members: members.map((member, index) => ({
      ...member,
      displayName: users[index]?.displayName,
      email: users[index]?.email
    }))
  });
});

eventRoutes.patch("/:eventId", async (c) => {
  const identity = requireUser(c);
  const loaded = await loadEventResource(c.get("db"), c.req.param("eventId"));
  assertAuthorized({
    principal: createUserPrincipal(identity.userId),
    action: "event.update",
    resource: loaded.resource
  });
  const body = await c.req.json<{
    name?: string;
    date?: string;
    locationLabel?: string;
    latitude?: number;
    longitude?: number;
    radiusMiles?: number;
    radiusMeters?: number;
    searchArea?: EventSearchArea;
  }>();
  const searchArea = searchAreaFromBody(body) ?? loaded.event.searchArea;
  const event: Event = {
    ...loaded.event,
    name: body.name?.trim() || loaded.event.name,
    date: body.date ?? loaded.event.date,
    locationLabel: searchArea?.displayName ?? body.locationLabel ?? loaded.event.locationLabel,
    location: searchArea
      ? { latitude: searchArea.latitude, longitude: searchArea.longitude }
      : loaded.event.location,
    searchArea,
    updatedAt: nowIso()
  };
  await c.get("db").updateEvent(event);
  return c.json({ event });
});

eventRoutes.delete("/:eventId", async (c) => {
  const identity = requireUser(c);
  const loaded = await loadEventResource(c.get("db"), c.req.param("eventId"));
  assertAuthorized({
    principal: createUserPrincipal(identity.userId),
    action: "event.delete",
    resource: loaded.resource
  });
  const eventId = loaded.event.id;
  await c.get("db").deleteEvent(eventId);
  await c.get("db").insertAudit({
    actorType: "user",
    actorId: identity.userId,
    action: "EVENT_DELETED",
    resource: eventId,
    decision: "ALLOW"
  });
  return c.json({ ok: true });
});

eventRoutes.get("/:eventId/invitations", async (c) => {
  const identity = requireUser(c);
  const loaded = await loadEventResource(c.get("db"), c.req.param("eventId"));
  assertAuthorized({
    principal: createUserPrincipal(identity.userId),
    action: "event.invite",
    resource: loaded.resource
  });
  const invitations = await c.get("db").listInvitations(loaded.event.id);
  return c.json({
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      type: invitation.type,
      destination: invitation.destination,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      createdAt: invitation.createdAt
    }))
  });
});

eventRoutes.post("/:eventId/invitations", async (c) => {
  const identity = requireUser(c);
  const db = c.get("db");
  const loaded = await loadEventResource(db, c.req.param("eventId"));
  assertAuthorized({
    principal: createUserPrincipal(identity.userId),
    action: "event.invite",
    resource: loaded.resource
  });
  const allowed = await db.consumeRateLimit(
    `invite:${identity.userId}`,
    10,
    60 * 60 * 1000
  );
  if (!allowed) {
    throw new AppError(ErrorCodes.RATE_LIMITED, "Too many invitations", 429);
  }
  const body = await c.req.json<{ email?: string }>();
  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new AppError(ErrorCodes.VALIDATION, "Invitation email is required", 400);
  }
  const token = randomToken(32);
  const invitation = {
    id: createId("inv"),
    eventId: loaded.event.id,
    invitedBy: identity.userId,
    type: "email" as const,
    destination: email,
    tokenHash: await hashToken(token),
    expiresAt: addHours(nowIso(), 24 * 7),
    createdAt: nowIso()
  };
  await db.createInvitation(invitation);
  const url = `${c.env.APP_ORIGIN}/join?invite=${token}`;
  const sender = new DevInvitationSender();
  const inviter = await db.getUser(identity.userId);
  await sender.sendEmail({
    destination: email,
    eventName: loaded.event.name,
    inviterName: inviter?.displayName ?? "A host",
    url
  });
  await db.insertAudit({
    eventId: loaded.event.id,
    actorType: "user",
    actorId: identity.userId,
    action: "INVITATION_CREATED",
    resource: "email",
    decision: "ALLOW"
  });
  return c.json({
    invitation: {
      id: invitation.id,
      type: invitation.type,
      destination: invitation.destination,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt
    },
    devInviteUrl: c.env.ENVIRONMENT === "development" ? url : undefined
  });
});

function preferenceVisibilityFromNotes(
  requested: "PUBLIC" | "PRIVATE",
  sourceText: string | undefined,
  value: Record<string, unknown> | undefined
): "PUBLIC" | "PRIVATE" {
  const noteText = [
    sourceText,
    typeof value?.text === "string" ? value.text : "",
    typeof value?.notes === "string" ? value.notes : ""
  ].join("\n");
  return requested === "PUBLIC" && textRequestsSecrecy(noteText) ? "PRIVATE" : requested;
}

eventRoutes.get("/:eventId/preferences", async (c) => {
  const identity = requireUser(c);
  const db = c.get("db");
  await assertEventRead(db, identity.userId, c.req.param("eventId"));
  const preferences = await db.listPreferences(c.req.param("eventId"));
  const vault = new (await import("../services/preference-vault.ts")).D1PreferenceVault(db);
  const visible = [];
  for (const preference of preferences) {
    const sanitized = sanitizePreferenceForViewer(preference, identity.userId);
    if (!sanitized) continue;
    if (preference.visibility === "PRIVATE") {
      const records = await vault.readPrivate(
        createUserPrincipal(identity.userId),
        identity.userId,
        preference.eventId
      );
      const mine = records.find((record) => record.preferenceId === preference.id);
      visible.push({
        ...sanitized,
        value: mine?.structuredValue,
        sourceText: mine?.sourceText
      });
    } else {
      visible.push(sanitized);
    }
  }
  return c.json({ preferences: visible });
});

eventRoutes.post("/:eventId/preferences/interpret", async (c) => {
  const identity = requireUser(c);
  const db = c.get("db");
  await assertEventRead(db, identity.userId, c.req.param("eventId"));
  const allowed = await db.consumeRateLimit(`pref-nl:${identity.userId}`, 40, 60 * 60 * 1000);
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many preference interpretations", 429);
  const body = await c.req.json<{ text?: string; visibility?: "PUBLIC" | "PRIVATE" }>();
  const text = body.text?.trim() ?? "";
  if (!text) throw new AppError(ErrorCodes.VALIDATION, "Describe the preference first", 400);
  const drafts = await interpretPreferenceNotes({
    text,
    requestedVisibility: body.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE",
    runtime: runtimeFromEnv(c.env)
  });
  return c.json({ drafts });
});

eventRoutes.post("/:eventId/preferences", async (c) => {
  const identity = requireUser(c);
  const db = c.get("db");
  const loaded = await assertEventRead(db, identity.userId, c.req.param("eventId"));
  const body = await c.req.json<{
    category?: string;
    visibility?: "PUBLIC" | "PRIVATE";
    priority?: "LOW" | "MEDIUM" | "HIGH" | "HARD";
    value?: Record<string, unknown>;
    sourceText?: string;
  }>();
  if (!body.category || !body.visibility || !body.priority) {
    throw new AppError(ErrorCodes.VALIDATION, "category, visibility, and priority are required", 400);
  }
  const visibility = preferenceVisibilityFromNotes(body.visibility, body.sourceText, body.value);
  const now = nowIso();
  const preference = {
    id: createId("prf"),
    eventId: loaded.event.id,
    userId: identity.userId,
    category: body.category as never,
    visibility,
    priority: body.priority,
    value: visibility === "PUBLIC" ? body.value : undefined,
    createdAt: now,
    updatedAt: now
  };
  assertAuthorized({
    principal: createUserPrincipal(identity.userId),
    action: "preference.own.write",
    resource: {
      type: "preference",
      userId: identity.userId,
      eventId: loaded.event.id,
      visibility
    }
  });
  await db.insertPreference(preference);
  if (visibility === "PRIVATE") {
    const { D1PreferenceVault } = await import("../services/preference-vault.ts");
    const vault = new D1PreferenceVault(db);
    await vault.upsertPrivate(createUserPrincipal(identity.userId), {
      preference,
      sourceText: body.sourceText ?? (typeof body.value?.text === "string" ? body.value.text : undefined),
      structuredValue: body.value ?? {}
    });
  }
  await db.insertAudit({
    eventId: loaded.event.id,
    actorType: "user",
    actorId: identity.userId,
    action: "PREFERENCE_CREATED",
    resource: `${visibility}:${body.category}`,
    decision: "ALLOW"
  });
  return c.json({ preference: { ...preference, value: body.value, sourceText: body.sourceText } }, 201);
});

eventRoutes.patch("/:eventId/preferences/:preferenceId", async (c) => {
  const identity = requireUser(c);
  const db = c.get("db");
  const loaded = await assertEventRead(db, identity.userId, c.req.param("eventId"));
  const existing = await db.getPreference(c.req.param("preferenceId"));
  if (!existing || existing.eventId !== loaded.event.id) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Preference not found", 404);
  }
  assertAuthorized({
    principal: createUserPrincipal(identity.userId),
    action: "preference.own.write",
    resource: {
      type: "preference",
      preferenceId: existing.id,
      userId: existing.userId,
      eventId: existing.eventId,
      visibility: existing.visibility
    }
  });
  const body = await c.req.json<{
    category?: string;
    visibility?: "PUBLIC" | "PRIVATE";
    priority?: "LOW" | "MEDIUM" | "HIGH" | "HARD";
    value?: Record<string, unknown>;
    sourceText?: string;
  }>();
  const category = body.category ?? existing.category;
  const requestedVisibility = body.visibility ?? existing.visibility;
  const priority = body.priority ?? existing.priority;
  const value = body.value ?? existing.value;
  const sourceText = body.sourceText;
  const visibility = preferenceVisibilityFromNotes(requestedVisibility, sourceText, value);
  const preference = {
    ...existing,
    category: category as typeof existing.category,
    visibility,
    priority,
    value: visibility === "PUBLIC" ? value : undefined,
    updatedAt: nowIso()
  };
  await db.updatePreference(preference);
  const vault = new (await import("../services/preference-vault.ts")).D1PreferenceVault(db);
  if (visibility === "PRIVATE") {
    await vault.upsertPrivate(createUserPrincipal(identity.userId), {
      preference,
      sourceText: sourceText ?? (typeof value?.text === "string" ? value.text : undefined),
      structuredValue: value ?? {}
    });
  } else {
    await db.deleteVaultByPreferenceId(preference.id);
  }
  await db.insertAudit({
    eventId: loaded.event.id,
    actorType: "user",
    actorId: identity.userId,
    action: "PREFERENCE_UPDATED",
    resource: `${visibility}:${preference.category}`,
    decision: "ALLOW"
  });
  return c.json({ preference: { ...preference, value, sourceText } });
});

eventRoutes.delete("/:eventId/preferences/:preferenceId", async (c) => {
  const identity = requireUser(c);
  const db = c.get("db");
  const loaded = await assertEventRead(db, identity.userId, c.req.param("eventId"));
  const existing = await db.getPreference(c.req.param("preferenceId"));
  if (!existing || existing.eventId !== loaded.event.id) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Preference not found", 404);
  }
  assertAuthorized({
    principal: createUserPrincipal(identity.userId),
    action: "preference.own.write",
    resource: {
      type: "preference",
      preferenceId: existing.id,
      userId: existing.userId,
      eventId: existing.eventId,
      visibility: existing.visibility
    }
  });
  await db.deletePreference(existing.id);
  await db.insertAudit({
    eventId: loaded.event.id,
    actorType: "user",
    actorId: identity.userId,
    action: "PREFERENCE_DELETED",
    resource: existing.id,
    decision: "ALLOW"
  });
  return c.json({ ok: true });
});

eventRoutes.get("/:eventId/audit", async (c) => {
  const identity = requireUser(c);
  const loaded = await loadEventResource(c.get("db"), c.req.param("eventId"));
  assertAuthorized({
    principal: createUserPrincipal(identity.userId),
    action: "audit.read",
    resource: {
      type: "audit",
      eventId: loaded.event.id,
      ownerId: loaded.event.ownerId,
      memberIds: loaded.resource.memberIds
    }
  });
  const events = await c.get("db").listAudit(loaded.event.id);
  return c.json({ events });
});
