import type { EventCreationIntent, MissingField } from "@rc/protocol";
import { CreateEventCommandSchema, type CreateEventCommand } from "@rc/protocol";
import { isValidIsoDate, combineDateAndTime } from "./dates.ts";
import { clampMiles } from "./extract.ts";

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidateEventIntentOutput {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function collectMissingFields(intent: EventCreationIntent): MissingField[] {
  const missing: MissingField[] = [];
  if (!intent.location?.query) {
    missing.push({ field: "location", required: true, reason: "A place or neighborhood is needed to search." });
  }
  return missing;
}

export function validateEventIntent(intent: EventCreationIntent): ValidateEventIntentOutput {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  if (intent.date && !isValidIsoDate(intent.date)) {
    errors.push({ field: "date", message: "Date is not a valid calendar day." });
  }
  if (intent.time?.time && !/^\d{2}:\d{2}$/.test(intent.time.time)) {
    errors.push({ field: "time", message: "Time must be HH:MM." });
  }
  if (intent.location?.radiusMiles != null) {
    const clamped = clampMiles(intent.location.radiusMiles);
    if (clamped !== intent.location.radiusMiles) {
      warnings.push({ field: "radiusMiles", message: "Radius was adjusted to a supported range." });
    }
  }
  if (intent.partySize != null && (intent.partySize < 1 || intent.partySize > 40)) {
    errors.push({ field: "partySize", message: "Party size must be between 1 and 40." });
  }
  if (intent.location?.resolvedLocation) {
    const loc = intent.location.resolvedLocation;
    if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
      errors.push({ field: "location", message: "Resolved coordinates are invalid." });
    }
  }
  if (intent.invitees) {
    for (const invitee of intent.invitees) {
      if (invitee.email && !invitee.email.includes("@")) {
        errors.push({ field: "invitees", message: "Invitee email is invalid." });
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function intentToCommand(
  intent: EventCreationIntent,
  timezone: string
): CreateEventCommand | undefined {
  const resolved = intent.location?.resolvedLocation;
  if (!intent.location?.query || !resolved) return undefined;
  const radiusMiles = clampMiles(intent.location.radiusMiles ?? 5);
  const date = intent.date
    ? combineDateAndTime(intent.date, intent.time?.time ?? "12:00", timezone)
    : undefined;
  const source = resolved.source;
  return CreateEventCommandSchema.parse({
    name: intent.title?.trim() || "Dinner",
    date,
    locationLabel: resolved.displayName,
    radiusMiles,
    searchArea: {
      displayName: resolved.displayName,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      radiusMeters: Math.round(Math.min(50_000, Math.max(500, radiusMiles * 1609.34))),
      source:
        source === "address" ||
        source === "city" ||
        source === "neighborhood" ||
        source === "landmark" ||
        source === "coordinates"
          ? source
          : "address",
      providerPlaceId: resolved.providerPlaceId
    }
  });
}

export function questionsFromIntent(intent: EventCreationIntent): string[] {
  const questions: string[] = [];
  for (const field of intent.missingFields) {
    if (!field.required) continue;
    if (field.field === "location") questions.push("Where should we search? A park, neighborhood, or city is enough.");
    else questions.push(field.reason ?? `Could you add ${field.field}?`);
  }
  for (const ambiguity of intent.ambiguities) {
    questions.push(ambiguity.description);
  }
  return questions;
}
