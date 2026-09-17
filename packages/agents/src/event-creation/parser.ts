import type {
  EventCreationIntent,
  EventParserContext,
  InviteeIntent,
  LlmEventIntentDraft
} from "@rc/protocol";
import { clampMiles, intentFromText, stripPrivateCopy, textHasPriceLanguage } from "./extract.ts";
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
    invitees: mergeInvitees(current.invitees, patch.invitees),
    restaurantSearchPolicy: patch.restaurantSearchPolicy ?? current.restaurantSearchPolicy,
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
    price: deterministic.price ?? (textHasPriceLanguage(text) ? draft.price : undefined),
    requirements: deterministic.requirements ?? draft.requirements,
    invitees: groundedInvitees(text, deterministic.invitees, draft.invitees),
    restaurantSearchPolicy: deterministic.restaurantSearchPolicy ?? draft.restaurantSearchPolicy,
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

export function mergeInvitees(
  current?: InviteeIntent[],
  patch?: InviteeIntent[]
): InviteeIntent[] | undefined {
  if (!patch?.length) return current;
  const invitees = new Map<string, InviteeIntent>();
  for (const item of [...(current ?? []), ...patch]) {
    const email = item.email?.trim().toLowerCase().replace(/[.,]+$/g, "");
    if (!email || !email.includes("@")) continue;
    const prior = invitees.get(email);
    invitees.set(email, {
      email,
      displayName: item.displayName?.trim() || prior?.displayName,
      phone: item.phone ?? prior?.phone
    });
  }
  return invitees.size ? [...invitees.values()] : current;
}

function groundedInvitees(
  text: string,
  current?: InviteeIntent[],
  draft?: InviteeIntent[]
): InviteeIntent[] | undefined {
  const haystack = text.toLowerCase();
  const grounded = (draft ?? []).filter((item) => {
    const email = item.email?.trim().toLowerCase();
    return Boolean(email && haystack.includes(email));
  });
  return mergeInvitees(current, grounded);
}
