import type {
  Event,
  EventMember,
  Invitation,
  Preference,
  PrivatePreferenceRecord,
  User
} from "@rc/domain";
import type { CouncilConstraint, CouncilSnapshot } from "@rc/protocol";
import type { Restaurant, RestaurantProviderType, RestaurantSearchResult } from "@rc/tools";
import { createId, nowIso } from "@rc/shared";
import { CollaborationStore } from "./collaboration.ts";
import { ResearchStore } from "./research.ts";
import {
  mapAudit,
  mapConstraint,
  mapEvent,
  mapInvitation,
  mapMember,
  mapPreference,
  mapUser,
  mapVault,
  parseSnapshot
} from "./maps.ts";

export class Database {
  readonly collab: CollaborationStore;
  readonly research: ResearchStore;

  constructor(private readonly db: D1Database) {
    this.collab = new CollaborationStore(db);
    this.research = new ResearchStore(db);
  }

  async getUser(id: string): Promise<User | null> {
    const row = await this.db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
    return row ? mapUser(row as Record<string, unknown>) : null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .bind(email.toLowerCase())
      .first();
    return row ? mapUser(row as Record<string, unknown>) : null;
  }

  async updateUserDisplayName(userId: string, displayName: string): Promise<User | null> {
    await this.db
      .prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind(displayName, userId)
      .run();
    return this.getUser(userId);
  }

  async getInvitation(id: string): Promise<Invitation | null> {
    const row = await this.db.prepare("SELECT * FROM invitations WHERE id = ?").bind(id).first();
    return row ? mapInvitation(row as Record<string, unknown>) : null;
  }

  async getInvitationByEventEmail(eventId: string, email: string): Promise<Invitation | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM invitations
         WHERE event_id = ? AND lower(destination) = ?
         ORDER BY created_at DESC`
      )
      .bind(eventId, email.toLowerCase())
      .first();
    return row ? mapInvitation(row as Record<string, unknown>) : null;
  }

  async listInvitationsSentBy(userId: string): Promise<Invitation[]> {
    const result = await this.db
      .prepare("SELECT * FROM invitations WHERE invited_by = ? ORDER BY created_at DESC")
      .bind(userId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapInvitation);
  }

  async listPendingInvitationsByEmail(email: string): Promise<Invitation[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM invitations
         WHERE lower(destination) = ? AND accepted_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC`
      )
      .bind(email.toLowerCase(), nowIso())
      .all();
    return (result.results as Record<string, unknown>[]).map(mapInvitation);
  }

  async listEventMemberUsers(userId: string): Promise<User[]> {
    const result = await this.db
      .prepare(
        `SELECT DISTINCT u.* FROM users u
         JOIN event_members mine ON mine.user_id = ?
         JOIN event_members other ON other.event_id = mine.event_id
         WHERE u.id = other.user_id`
      )
      .bind(userId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapUser);
  }

  async createUser(input: { displayName?: string; email?: string }): Promise<User> {
    const user: User = {
      id: createId("usr"),
      displayName: input.displayName,
      email: input.email?.toLowerCase(),
      createdAt: nowIso()
    };
    await this.db
      .prepare(
        "INSERT INTO users (id, display_name, email, phone, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(user.id, user.displayName ?? null, user.email ?? null, null, user.createdAt)
      .run();
    return user;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(createId("ses"), userId, tokenHash, expiresAt, nowIso())
      .run();
  }

  async getSessionUser(tokenHash: string): Promise<User | null> {
    const row = await this.db
      .prepare(
        `SELECT u.* FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .bind(tokenHash, nowIso())
      .first();
    return row ? mapUser(row as Record<string, unknown>) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }

  async createEvent(event: Event): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO events (
          id, owner_id, name, date, timezone, location_label, latitude, longitude, radius_meters,
          location_source, location_place_id, restaurant_search_policy, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        event.id,
        event.ownerId,
        event.name,
        event.date ?? null,
        event.timezone ?? null,
        event.searchArea?.displayName ?? event.locationLabel ?? null,
        event.searchArea?.latitude ?? event.location?.latitude ?? null,
        event.searchArea?.longitude ?? event.location?.longitude ?? null,
        event.searchArea?.radiusMeters ?? null,
        event.searchArea?.source ?? null,
        event.searchArea?.providerPlaceId ?? null,
        event.restaurantSearchPolicy ? JSON.stringify(event.restaurantSearchPolicy) : null,
        event.status,
        event.createdAt,
        event.updatedAt
      )
      .run();
  }

  async updateEvent(event: Event): Promise<void> {
    await this.db
      .prepare(
        `UPDATE events SET name = ?, date = ?, timezone = ?, location_label = ?, latitude = ?, longitude = ?,
         radius_meters = ?, location_source = ?, location_place_id = ?, restaurant_search_policy = ?,
         status = ?, updated_at = ? WHERE id = ?`
      )
      .bind(
        event.name,
        event.date ?? null,
        event.timezone ?? null,
        event.searchArea?.displayName ?? event.locationLabel ?? null,
        event.searchArea?.latitude ?? event.location?.latitude ?? null,
        event.searchArea?.longitude ?? event.location?.longitude ?? null,
        event.searchArea?.radiusMeters ?? null,
        event.searchArea?.source ?? null,
        event.searchArea?.providerPlaceId ?? null,
        event.restaurantSearchPolicy ? JSON.stringify(event.restaurantSearchPolicy) : null,
        event.status,
        event.updatedAt,
        event.id
      )
      .run();
  }

  async getEvent(id: string): Promise<Event | null> {
    const row = await this.db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
    return row ? mapEvent(row as Record<string, unknown>) : null;
  }

  async listEventsForUser(userId: string): Promise<Event[]> {
    const result = await this.db
      .prepare(
        `SELECT e.* FROM events e
         JOIN event_members m ON m.event_id = e.id
         WHERE m.user_id = ?
         ORDER BY e.updated_at DESC`
      )
      .bind(userId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapEvent);
  }

  async deleteEvent(eventId: string): Promise<void> {
    const tables = [
      "preference_vault",
      "preferences",
      "preference_prompts",
      "event_chat_messages",
      "verification_tasks",
      "human_evidence",
      "restaurant_decisions",
      "council_actions",
      "event_restaurant_candidates",
      "restaurant_searches",
      "derived_constraints",
      "council_sessions",
      "invitations",
      "event_members",
      "audit_events"
    ];
    const statements = tables.map((table) =>
      this.db.prepare(`DELETE FROM ${table} WHERE event_id = ?`).bind(eventId)
    );
    statements.push(this.db.prepare("DELETE FROM events WHERE id = ?").bind(eventId));
    await this.db.batch(statements);
  }

  async upsertMember(member: EventMember): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO event_members (event_id, user_id, role, status, joined_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(event_id, user_id) DO UPDATE SET
           role = excluded.role,
           status = excluded.status,
           joined_at = excluded.joined_at`
      )
      .bind(
        member.eventId,
        member.userId,
        member.role,
        member.status,
        member.joinedAt ?? null
      )
      .run();
  }

  async listMembers(eventId: string): Promise<EventMember[]> {
    const result = await this.db
      .prepare("SELECT * FROM event_members WHERE event_id = ?")
      .bind(eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapMember);
  }

  async createInvitation(invitation: Invitation): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO invitations (
          id, event_id, invited_by, type, destination, token_hash, expires_at, accepted_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        invitation.id,
        invitation.eventId,
        invitation.invitedBy,
        invitation.type,
        invitation.destination,
        invitation.tokenHash,
        invitation.expiresAt,
        invitation.acceptedAt ?? null,
        invitation.createdAt
      )
      .run();
  }

  async getInvitationByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const row = await this.db
      .prepare("SELECT * FROM invitations WHERE token_hash = ?")
      .bind(tokenHash)
      .first();
    return row ? mapInvitation(row as Record<string, unknown>) : null;
  }

  async listInvitations(eventId: string): Promise<Invitation[]> {
    const result = await this.db
      .prepare("SELECT * FROM invitations WHERE event_id = ? ORDER BY created_at DESC")
      .bind(eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapInvitation);
  }

  async markInvitationAccepted(id: string, acceptedAt: string): Promise<void> {
    await this.db
      .prepare("UPDATE invitations SET accepted_at = ? WHERE id = ?")
      .bind(acceptedAt, id)
      .run();
  }

  async insertPreference(preference: Preference): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO preferences (
          id, event_id, user_id, category, visibility, priority, public_value, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        preference.id,
        preference.eventId,
        preference.userId,
        preference.category,
        preference.visibility,
        preference.priority,
        preference.visibility === "PUBLIC" ? JSON.stringify(preference.value ?? {}) : null,
        preference.createdAt,
        preference.updatedAt
      )
      .run();
  }

  async updatePreference(preference: Preference): Promise<void> {
    await this.db
      .prepare(
        `UPDATE preferences SET category = ?, visibility = ?, priority = ?, public_value = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        preference.category,
        preference.visibility,
        preference.priority,
        preference.visibility === "PUBLIC" ? JSON.stringify(preference.value ?? {}) : null,
        preference.updatedAt,
        preference.id
      )
      .run();
  }

  async getPreference(id: string): Promise<Preference | null> {
    const row = await this.db
      .prepare("SELECT * FROM preferences WHERE id = ?")
      .bind(id)
      .first();
    return row ? mapPreference(row as Record<string, unknown>) : null;
  }

  async listPreferences(eventId: string): Promise<Preference[]> {
    const result = await this.db
      .prepare("SELECT * FROM preferences WHERE event_id = ? ORDER BY created_at")
      .bind(eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapPreference);
  }

  async deletePreference(id: string): Promise<void> {
    await this.deleteVaultByPreferenceId(id);
    await this.db.prepare("DELETE FROM preferences WHERE id = ?").bind(id).run();
  }

  async deleteVaultByPreferenceId(preferenceId: string): Promise<void> {
    await this.db.prepare("DELETE FROM preference_vault WHERE preference_id = ?").bind(preferenceId).run();
  }

  async upsertVault(record: PrivatePreferenceRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO preference_vault (
          id, preference_id, user_id, event_id, category, source_text, structured_value, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(preference_id) DO UPDATE SET
          category = excluded.category,
          source_text = excluded.source_text,
          structured_value = excluded.structured_value,
          updated_at = excluded.updated_at`
      )
      .bind(
        record.id,
        record.preferenceId,
        record.userId,
        record.eventId,
        record.category,
        record.sourceText ?? null,
        JSON.stringify(record.structuredValue),
        record.createdAt,
        record.updatedAt
      )
      .run();
  }

  async readVault(userId: string, eventId: string): Promise<PrivatePreferenceRecord[]> {
    const result = await this.db
      .prepare("SELECT * FROM preference_vault WHERE user_id = ? AND event_id = ?")
      .bind(userId, eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapVault);
  }

  async getVaultByPreferenceId(preferenceId: string): Promise<PrivatePreferenceRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM preference_vault WHERE preference_id = ?")
      .bind(preferenceId)
      .first();
    return row ? mapVault(row as Record<string, unknown>) : null;
  }

  async replaceConstraints(eventId: string, constraints: CouncilConstraint[]): Promise<void> {
    await this.db.prepare("DELETE FROM derived_constraints WHERE event_id = ?").bind(eventId).run();
    for (const constraint of constraints) {
      await this.db
        .prepare(
          `INSERT INTO derived_constraints (
            id, event_id, participant_id, type, value, priority, visibility, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          constraint.id,
          constraint.eventId,
          constraint.participantId,
          constraint.type,
          JSON.stringify(constraint.value),
          constraint.priority,
          constraint.visibility,
          nowIso()
        )
        .run();
    }
  }

  async listConstraints(eventId: string): Promise<CouncilConstraint[]> {
    const result = await this.db
      .prepare("SELECT * FROM derived_constraints WHERE event_id = ?")
      .bind(eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapConstraint);
  }

  async saveCouncilSnapshot(snapshot: CouncilSnapshot): Promise<void> {
    const now = nowIso();
    await this.db
      .prepare(
        `INSERT INTO council_sessions (id, event_id, status, state_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET
           id = excluded.id,
           status = excluded.status,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`
      )
      .bind(
        snapshot.sessionId,
        snapshot.eventId,
        snapshot.status,
        JSON.stringify(snapshot),
        now,
        now
      )
      .run();
  }

  async getCouncilSnapshot(eventId: string): Promise<CouncilSnapshot | null> {
    const row = await this.db
      .prepare("SELECT state_json FROM council_sessions WHERE event_id = ?")
      .bind(eventId)
      .first<{ state_json: string }>();
    return row ? parseSnapshot(row.state_json) : null;
  }

  async insertAudit(input: {
    eventId?: string;
    actorType: string;
    actorId: string;
    action: string;
    resource?: string;
    decision?: string;
    reason?: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO audit_events (
          id, event_id, actor_type, actor_id, action, resource, decision, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        createId("aud"),
        input.eventId ?? null,
        input.actorType,
        input.actorId,
        input.action,
        input.resource ?? null,
        input.decision ?? null,
        input.reason ?? null,
        nowIso()
      )
      .run();
  }

  async listAudit(eventId: string): Promise<ReturnType<typeof mapAudit>[]> {
    const result = await this.db
      .prepare(
        "SELECT * FROM audit_events WHERE event_id = ? ORDER BY created_at DESC LIMIT 100"
      )
      .bind(eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapAudit);
  }

  async consumeRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const row = await this.db
      .prepare("SELECT count, window_start FROM rate_limits WHERE key = ?")
      .bind(key)
      .first<{ count: number; window_start: string }>();
    if (!row) {
      await this.db
        .prepare("INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)")
        .bind(key, new Date(now).toISOString())
        .run();
      return true;
    }
    const start = new Date(row.window_start).getTime();
    if (now - start > windowMs) {
      await this.db
        .prepare("UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ?")
        .bind(new Date(now).toISOString(), key)
        .run();
      return true;
    }
    if (row.count >= limit) return false;
    await this.db
      .prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?")
      .bind(key)
      .run();
    return true;
  }

  async getRestaurantReference(id: string): Promise<Restaurant | null> {
    const row = await this.db
      .prepare(
        "SELECT id, provider, provider_restaurant_id, name, latitude, longitude, cached_data FROM restaurant_references WHERE id = ?"
      )
      .bind(id)
      .first<RestaurantReferenceRow>();
    return restaurantFromReferenceRow(row);
  }

  async getRestaurantReferenceByProvider(
    provider: RestaurantProviderType,
    providerId: string
  ): Promise<Restaurant | null> {
    const row = await this.db
      .prepare(
        "SELECT id, provider, provider_restaurant_id, name, latitude, longitude, cached_data FROM restaurant_references WHERE provider = ? AND provider_restaurant_id = ?"
      )
      .bind(provider, providerId)
      .first<RestaurantReferenceRow>();
    return restaurantFromReferenceRow(row);
  }

  async clearPlacesCache(): Promise<void> {
    const at = nowIso();
    await this.db.batch([
      this.db.prepare("DELETE FROM restaurant_search_cache"),
      this.db.prepare(
        "UPDATE restaurant_references SET cached_data = NULL, cached_at = NULL, updated_at = ?"
      ).bind(at),
      this.db.prepare("DELETE FROM dietary_evidence"),
      this.db.prepare("DELETE FROM dietary_assessments")
    ]);
  }

  async upsertRestaurantReference(restaurant: Restaurant, at: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO restaurant_references (
          id, provider, provider_restaurant_id, name, latitude, longitude, cached_data, cached_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, provider_restaurant_id) DO UPDATE SET
          id = excluded.id,
          name = excluded.name,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          cached_data = excluded.cached_data,
          cached_at = excluded.cached_at,
          updated_at = excluded.updated_at`
      )
      .bind(
        restaurant.id,
        restaurant.provider,
        restaurant.providerId,
        restaurant.name,
        restaurant.location.latitude,
        restaurant.location.longitude,
        JSON.stringify(restaurant),
        at,
        at,
        at
      )
      .run();
  }

  async getRestaurantSearchCache(key: string): Promise<RestaurantSearchResult | null> {
    const row = await this.db
      .prepare("SELECT payload, expires_at FROM restaurant_search_cache WHERE cache_key = ?")
      .bind(key)
      .first<{ payload: string; expires_at: string }>();
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.db.prepare("DELETE FROM restaurant_search_cache WHERE cache_key = ?").bind(key).run();
      return null;
    }
    return JSON.parse(row.payload) as RestaurantSearchResult;
  }

  async setRestaurantSearchCache(
    key: string,
    result: RestaurantSearchResult,
    ttlMs: number
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await this.db
      .prepare(
        `INSERT INTO restaurant_search_cache (cache_key, payload, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at`
      )
      .bind(key, JSON.stringify(result), expiresAt)
      .run();
  }

  async recordRestaurantSearch(input: {
    eventId?: string;
    provider: string;
    location: { latitude: number; longitude: number };
    radius: number;
    constraints: unknown;
    query?: string;
    resultCount: number;
  }): Promise<string> {
    const id = createId("rsh");
    await this.db
      .prepare(
        `INSERT INTO restaurant_searches (
          id, event_id, provider, location, radius, constraints, query, result_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.eventId ?? null,
        input.provider,
        JSON.stringify(input.location),
        input.radius,
        JSON.stringify(input.constraints),
        input.query ?? null,
        input.resultCount,
        nowIso()
      )
      .run();
    return id;
  }

  async getDietaryAssessment(
    restaurantId: string,
    requirement: string,
    evidenceMode: string
  ): Promise<import("@rc/protocol").DietaryAssessment | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM dietary_assessments
         WHERE restaurant_id = ? AND requirement = ? AND evidence_mode = ?`
      )
      .bind(restaurantId, requirement, evidenceMode)
      .first<Record<string, unknown>>();
    if (!row) return null;
    if (row.expires_at && Date.parse(String(row.expires_at)) <= Date.now()) {
      await this.db.prepare("DELETE FROM dietary_evidence WHERE assessment_id = ?").bind(row.id).run();
      await this.db.prepare("DELETE FROM dietary_assessments WHERE id = ?").bind(row.id).run();
      return null;
    }
    const evidence = await this.db
      .prepare("SELECT * FROM dietary_evidence WHERE assessment_id = ?")
      .bind(row.id)
      .all<Record<string, unknown>>();
    return {
      restaurantId: String(row.restaurant_id),
      requirement: String(row.requirement),
      status: row.status as import("@rc/protocol").DietaryAssessment["status"],
      confidence: Number(row.confidence),
      analyzedAt: String(row.analyzed_at),
      expiresAt: row.expires_at ? String(row.expires_at) : undefined,
      evidence: (evidence.results ?? []).map((item) => ({
        id: String(item.id),
        sourceType: item.source_type as import("@rc/protocol").DietaryEvidence["sourceType"],
        sourceUrl: item.source_url ? String(item.source_url) : undefined,
        sourceName: item.source_name ? String(item.source_name) : undefined,
        observedAt: item.observed_at ? String(item.observed_at) : undefined,
        excerpt: item.excerpt ? String(item.excerpt) : undefined,
        supports: item.supports as import("@rc/protocol").DietaryEvidence["supports"],
        reliability: item.reliability as import("@rc/protocol").DietaryEvidence["reliability"],
        scope: item.scope ? (item.scope as import("@rc/protocol").DietaryEvidence["scope"]) : undefined
      }))
    };
  }

  async saveDietaryAssessment(
    assessment: import("@rc/protocol").DietaryAssessment,
    evidenceMode: string
  ): Promise<void> {
    const existing = await this.db
      .prepare(
        `SELECT id FROM dietary_assessments
         WHERE restaurant_id = ? AND requirement = ? AND evidence_mode = ?`
      )
      .bind(assessment.restaurantId, assessment.requirement, evidenceMode)
      .first<{ id: string }>();
    const id = existing?.id ?? createId("das");
    const at = nowIso();
    if (existing) {
      await this.db.prepare("DELETE FROM dietary_evidence WHERE assessment_id = ?").bind(id).run();
      await this.db
        .prepare(
          `UPDATE dietary_assessments
           SET status = ?, confidence = ?, analyzed_at = ?, expires_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          assessment.status,
          assessment.confidence,
          assessment.analyzedAt,
          assessment.expiresAt ?? null,
          at,
          id
        )
        .run();
    } else {
      await this.db
        .prepare(
          `INSERT INTO dietary_assessments (
            id, restaurant_id, requirement, evidence_mode, status, confidence,
            analyzed_at, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          assessment.restaurantId,
          assessment.requirement,
          evidenceMode,
          assessment.status,
          assessment.confidence,
          assessment.analyzedAt,
          assessment.expiresAt ?? null,
          at,
          at
        )
        .run();
    }
    for (const item of assessment.evidence) {
      await this.db
        .prepare(
          `INSERT INTO dietary_evidence (
            id, assessment_id, source_type, source_url, source_name, supports,
            reliability, scope, excerpt, observed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          item.id,
          id,
          item.sourceType,
          item.sourceUrl ?? null,
          item.sourceName ?? null,
          item.supports,
          item.reliability,
          item.scope ?? null,
          item.excerpt ?? null,
          item.observedAt ?? null,
          at
        )
        .run();
    }
  }
}

interface RestaurantReferenceRow {
  id: string;
  provider: string;
  provider_restaurant_id: string;
  name: string;
  latitude: number;
  longitude: number;
  cached_data: string | null;
}

function restaurantFromReferenceRow(row: RestaurantReferenceRow | null): Restaurant | null {
  if (!row) return null;
  if (row.cached_data) return JSON.parse(row.cached_data) as Restaurant;
  return {
    id: row.id,
    provider: row.provider as RestaurantProviderType,
    providerId: row.provider_restaurant_id,
    name: row.name,
    location: { latitude: row.latitude, longitude: row.longitude },
    cuisines: []
  };
}
