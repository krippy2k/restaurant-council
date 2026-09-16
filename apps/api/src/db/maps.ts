import type {
  AuditEvent,
  Event,
  EventMember,
  EventSearchAreaSource,
  Invitation,
  Preference,
  PrivatePreferenceRecord,
  User
} from "@rc/domain";
import type { CouncilConstraint, CouncilSnapshot } from "@rc/protocol";

export function mapUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    displayName: row.display_name ? String(row.display_name) : undefined,
    email: row.email ? String(row.email) : undefined,
    phone: row.phone ? String(row.phone) : undefined,
    createdAt: String(row.created_at)
  };
}

export function mapEvent(row: Record<string, unknown>): Event {
  const latitude = row.latitude == null ? undefined : Number(row.latitude);
  const longitude = row.longitude == null ? undefined : Number(row.longitude);
  const radiusMeters = row.radius_meters == null ? undefined : Number(row.radius_meters);
  const location =
    latitude != null && longitude != null ? { latitude, longitude } : undefined;
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    date: row.date ? String(row.date) : undefined,
    locationLabel: row.location_label ? String(row.location_label) : undefined,
    location,
    searchArea:
      location && radiusMeters != null
        ? {
            displayName: row.location_label ? String(row.location_label) : "Search area",
            latitude: location.latitude,
            longitude: location.longitude,
            radiusMeters,
            source: row.location_source
              ? (String(row.location_source) as EventSearchAreaSource)
              : undefined,
            providerPlaceId: row.location_place_id ? String(row.location_place_id) : undefined
          }
        : location
          ? {
              displayName: row.location_label ? String(row.location_label) : "Search area",
              latitude: location.latitude,
              longitude: location.longitude,
              radiusMeters: 8047,
              source: "city"
            }
          : undefined,
    status: row.status as Event["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapMember(row: Record<string, unknown>): EventMember {
  return {
    eventId: String(row.event_id),
    userId: String(row.user_id),
    role: row.role as EventMember["role"],
    status: row.status as EventMember["status"],
    joinedAt: row.joined_at ? String(row.joined_at) : undefined
  };
}

export function mapInvitation(row: Record<string, unknown>): Invitation {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    invitedBy: String(row.invited_by),
    type: row.type as Invitation["type"],
    destination: String(row.destination),
    tokenHash: String(row.token_hash),
    expiresAt: String(row.expires_at),
    acceptedAt: row.accepted_at ? String(row.accepted_at) : undefined,
    createdAt: String(row.created_at)
  };
}

export function mapPreference(row: Record<string, unknown>): Preference {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    userId: String(row.user_id),
    category: row.category as Preference["category"],
    visibility: row.visibility as Preference["visibility"],
    priority: row.priority as Preference["priority"],
    value: row.public_value
      ? (JSON.parse(String(row.public_value)) as Record<string, unknown>)
      : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapVault(row: Record<string, unknown>): PrivatePreferenceRecord {
  return {
    id: String(row.id),
    preferenceId: String(row.preference_id),
    userId: String(row.user_id),
    eventId: String(row.event_id),
    category: row.category as PrivatePreferenceRecord["category"],
    sourceText: row.source_text ? String(row.source_text) : undefined,
    structuredValue: JSON.parse(String(row.structured_value)) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapConstraint(row: Record<string, unknown>): CouncilConstraint {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    participantId: String(row.participant_id),
    type: row.type as CouncilConstraint["type"],
    value: JSON.parse(String(row.value)) as unknown,
    priority: row.priority as CouncilConstraint["priority"],
    visibility: row.visibility as CouncilConstraint["visibility"]
  };
}

export function mapAudit(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    eventId: row.event_id ? String(row.event_id) : undefined,
    actorType: String(row.actor_type),
    actorId: String(row.actor_id),
    action: String(row.action),
    resource: row.resource ? String(row.resource) : undefined,
    decision: row.decision ? String(row.decision) : undefined,
    reason: row.reason ? String(row.reason) : undefined,
    createdAt: String(row.created_at)
  };
}

export function parseSnapshot(json: string): CouncilSnapshot {
  return JSON.parse(json) as CouncilSnapshot;
}
