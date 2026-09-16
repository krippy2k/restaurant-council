import type { EventCreationIntent, EventParserContext, LlmEventIntentDraft } from "@rc/protocol";
import { clampMiles, intentFromText, stripPrivateCopy } from "./extract.ts";
import { resolveRelativeDate } from "./dates.ts";

export interface EventIntentParser {
  parse(text: string, context: EventParserContext): Promise<EventCreationIntent>;
}

export class MockEventIntentParser implements EventIntentParser {
  async parse(text: string, context: EventParserContext): Promise<EventCreationIntent> {
    return intentFromText(text, context);
  }
}

export function mergeIntent(
  current: EventCreationIntent,
  patch: EventCreationIntent
): EventCreationIntent {
  return {
    eventType: "restaurant",
    title: patch.title ?? current.title,
    date: patch.date ?? current.date,
    time: patch.time ?? current.time,
    partySize: patch.partySize ?? current.partySize,
    location:
      patch.location?.query || patch.location?.radiusMiles != null
        ? {
            query: patch.location.query || current.location?.query || "",
            radiusMiles: patch.location.radiusMiles ?? current.location?.radiusMiles
          }
        : current.location,
    cuisines: patch.cuisines ?? current.cuisines,
    dietaryRequirements: patch.dietaryRequirements ?? current.dietaryRequirements,
    price: patch.price ?? current.price,
    requirements: patch.requirements ?? current.requirements,
    invitees: patch.invitees ?? current.invitees,
    missingFields: [],
    ambiguities: [],
    source: current.source
  };
}

export function applyDraft(
  text: string,
  context: EventParserContext,
  draft: LlmEventIntentDraft
): EventCreationIntent {
  const deterministic = intentFromText(text, context);
  const date = resolveRelativeDate(text, context) ?? (draft.relativeDate
    ? resolveRelativeDate(draft.relativeDate, context)
    : undefined) ?? deterministic.date ?? draft.date;
  const merged: EventCreationIntent = {
    eventType: "restaurant",
    title: deterministic.title ?? draft.title,
    date,
    time: deterministic.time ?? draft.time,
    partySize: deterministic.partySize ?? draft.partySize,
    location: groundedLocation(text, deterministic, draft),
    cuisines: deterministic.cuisines ?? draft.cuisines,
    dietaryRequirements: deterministic.dietaryRequirements ?? draft.dietaryRequirements,
    price: deterministic.price ?? draft.price,
    requirements: deterministic.requirements ?? draft.requirements,
    invitees: deterministic.invitees ?? draft.invitees,
    missingFields: [],
    ambiguities: [],
    source: "natural-language"
  };
  return stripPrivateCopy(merged, text);
}

function groundedLocation(
  text: string,
  deterministic: EventCreationIntent,
  draft: LlmEventIntentDraft
): EventCreationIntent["location"] {
  const rawRadius = deterministic.location?.radiusMiles ?? draft.location?.radiusMiles;
  const radiusMiles = rawRadius != null ? clampMiles(rawRadius) : undefined;
  if (deterministic.location?.query) {
    return {
      query: deterministic.location.query,
      radiusMiles: deterministic.location.radiusMiles != null
        ? clampMiles(deterministic.location.radiusMiles)
        : radiusMiles
    };
  }
  const query = draft.location?.query?.trim();
  if (query && queryGroundedInText(query, text)) {
    return { query, radiusMiles };
  }
  return deterministic.location;
}

function queryGroundedInText(query: string, text: string): boolean {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (haystack.includes(needle)) return true;
  const token = needle.split(/[,\s]+/).find((part) => part.length > 3);
  return Boolean(token && haystack.includes(token));
}
