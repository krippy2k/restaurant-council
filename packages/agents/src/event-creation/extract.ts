import { parseDietaryConstraints, type EventCreationIntent, type EventParserContext } from "@rc/protocol";
import { textRequestsSecrecy } from "@rc/domain";
import { extractTimeIntent, resolveRelativeDate } from "./dates.ts";

const KID_FRIENDLY = /kid[- ]friendly|family[- ]friendly|good for (kids|children)|take the kids/;
const OUTDOOR = /\boutdoor seating\b|\boutside\b|\bpatio\b/;
const QUIET = /\bquiet\b|\bnot too loud\b/;

export function extractRadiusMiles(text: string): number | undefined {
  const match = text.toLowerCase().match(/(\d+(?:\.\d+)?)\s*miles?\b/);
  if (match) return clampMiles(Number(match[1]));
  return undefined;
}

export function clampMiles(miles: number): number {
  if (!Number.isFinite(miles)) return 5;
  return Math.min(31, Math.max(0.3, miles));
}

const LOCATION_STOP =
  /\s+on\s+|\s+at\s+|\s+that\s+|\s+for\s+|\s+who\s+|\s+with\s+|\s+(?:today|tomorrow|this|next)\b|\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\s*$/i;

export function extractLocationQuery(text: string): string | undefined {
  const lower = text.replace(/\s+/g, " ").trim();
  const ofMatch = lower.match(
    new RegExp(
      `(?:within\\s+\\d+(?:\\.\\d+)?\\s*miles?\\s+of|near|close to|around(?!\\s+\\d))\\s+(.+?)(?=${LOCATION_STOP.source})`,
      "i"
    )
  );
  if (ofMatch?.[1]) return cleanLocationQuery(ofMatch[1]);
  return undefined;
}

function cleanLocationQuery(value: string): string {
  return value
    .replace(/\b(that is|that's|which is|and is)\b.*$/i, "")
    .replace(/\b(kid|family)[- ]friendly\b.*$/i, "")
    .replace(/[.,]+$/g, "")
    .trim();
}

const WORD_COUNTS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

function parseCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  return WORD_COUNTS[raw.toLowerCase()];
}

export function extractPartySize(text: string): number | undefined {
  const lower = text.toLowerCase();
  const count = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";
  const adultsKids = lower.match(new RegExp(`${count}\\s+adults?\\s+and\\s+${count}\\s+(?:kids?|children)`));
  if (adultsKids) {
    const adults = parseCount(adultsKids[1]);
    const kids = parseCount(adultsKids[2]);
    if (adults != null && kids != null) return adults + kids;
  }
  const party = lower.match(new RegExp(`party of\\s+${count}`));
  if (party) return parseCount(party[1]);
  const people = lower.match(new RegExp(`for\\s+${count}\\s+people`));
  if (people) return parseCount(people[1]);
  return undefined;
}

export function extractPrice(text: string): EventCreationIntent["price"] | undefined {
  const lower = text.toLowerCase().replaceAll("’", "'");
  const under = lower.match(/under\s*\$?\s*(\d+)/);
  const around = lower.match(/around\s*\$?\s*(\d+)/);
  const amount = under ? Number(under[1]) : around ? Number(around[1]) : undefined;
  const preferred =
    /would rather|rather keep|prefer|i'd like to stay|don't tell|dont tell|money is tight/.test(lower);
  if (amount) {
    const level = amount <= 15 ? 1 : amount <= 30 ? 2 : amount <= 60 ? 3 : 4;
    return {
      maxPerPerson: amount,
      providerPriceLevels: [1, level].filter((item, index, all) => all.indexOf(item) === index && item <= level),
      strength: preferred || around ? "preferred" : "required"
    };
  }
  if (/\bcheap\b|\binexpensive\b|nothing too expensive/.test(lower)) {
    return { providerPriceLevels: [1, 2], description: "inexpensive", strength: "preferred" };
  }
  const dollars = lower.match(/(\${1,4})\s*or less/);
  if (dollars) {
    return { providerPriceLevels: range(1, dollars[1].length), strength: "required" };
  }
  return undefined;
}

function range(from: number, to: number): number[] {
  const values = [];
  for (let i = from; i <= to; i += 1) values.push(i);
  return values;
}

export function extractCuisines(text: string): EventCreationIntent["cuisines"] {
  const lower = text.toLowerCase();
  const cuisines: NonNullable<EventCreationIntent["cuisines"]> = [];
  const mentioned = [
    "italian",
    "mexican",
    "thai",
    "chinese",
    "japanese",
    "indian",
    "french",
    "steak",
    "seafood",
    "pizza",
    "sushi",
    "american"
  ];
  for (const cuisine of mentioned) {
    if (new RegExp(`\\bno ${cuisine}\\b`).test(lower)) {
      cuisines.push({ value: cuisine, strength: "required", polarity: "exclude" });
    } else if (new RegExp(`\\b${cuisine}\\b`).test(lower)) {
      const preferred = /would be nice|prefer|i'd like/.test(lower);
      cuisines.push({
        value: cuisine,
        strength: preferred ? "preferred" : "required",
        polarity: "include"
      });
    }
  }
  return cuisines.length ? cuisines : undefined;
}

export function extractDietary(text: string): EventCreationIntent["dietaryRequirements"] {
  const parsed = [];
  const lower = text.toLowerCase();
  if (/\bvegan\b/.test(lower)) {
    parsed.push(...parseDietaryConstraints({ requirement: "vegan", strength: "required" }));
  } else if (/\bvegetarian\b/.test(lower)) {
    parsed.push(...parseDietaryConstraints({ requirement: "vegetarian", strength: "required" }));
  }
  if (/\bdairy[- ]free\b|\blactose\b/.test(lower)) {
    parsed.push(
      ...parseDietaryConstraints({
        requirement: "dairy-free",
        strength: "required",
        evidenceRequirement: /strict|allergy/.test(lower) ? "strict" : "normal"
      })
    );
  }
  if (/\bgluten[- ]free\b|\bceliac\b/.test(lower)) {
    parsed.push(...parseDietaryConstraints({ requirement: "gluten-free", strength: "required" }));
  }
  return parsed.length ? parsed : undefined;
}

export function extractRequirements(text: string): EventCreationIntent["requirements"] {
  const lower = text.toLowerCase();
  const requirements = [];
  if (KID_FRIENDLY.test(lower)) requirements.push({ type: "kid-friendly", strength: "required" as const });
  if (OUTDOOR.test(lower)) requirements.push({ type: "outdoor-seating", strength: "preferred" as const });
  if (QUIET.test(lower)) requirements.push({ type: "quiet", strength: "preferred" as const });
  return requirements.length ? requirements : undefined;
}

export function extractInvitees(text: string): EventCreationIntent["invitees"] {
  const invitees = [];
  const email = [...text.matchAll(/invite\s+([A-Za-z]+)\s+at\s+(\S+@\S+\.\S+)/gi)];
  for (const match of email) {
    invitees.push({ displayName: match[1], email: match[2]?.replace(/[.,]$/, "").toLowerCase() });
  }
  return invitees.length ? invitees : undefined;
}

export function defaultTitle(intent: Pick<EventCreationIntent, "date" | "requirements" | "cuisines">): string {
  if (intent.requirements?.some((item) => item.type === "kid-friendly")) return "Family dinner";
  const cuisine = intent.cuisines?.find((item) => item.polarity !== "exclude")?.value;
  if (cuisine) return `${cuisine[0]?.toUpperCase()}${cuisine.slice(1)} dinner`;
  return "Dinner";
}

export function stripPrivateCopy<T extends EventCreationIntent>(intent: T, sourceText: string): T {
  const secret = textRequestsSecrecy(sourceText);
  const unsafe = /money is tight|lost (a |the )?job|don't tell|allergy|medical/i;
  const title = intent.title && unsafe.test(intent.title) ? undefined : intent.title;
  return {
    ...intent,
    title,
    price: intent.price
      ? {
          ...intent.price,
          description: intent.price.description && unsafe.test(intent.price.description)
            ? undefined
            : intent.price.description,
          strength: secret && intent.price.strength === "required" ? "preferred" : intent.price.strength
        }
      : intent.price
  };
}

export function intentFromText(text: string, context: EventParserContext): EventCreationIntent {
  const date = resolveRelativeDate(text, context);
  const time = extractTimeIntent(text);
  const radiusMiles = extractRadiusMiles(text);
  const query = extractLocationQuery(text);
  const intent: EventCreationIntent = {
    eventType: "restaurant",
    date,
    time,
    partySize: extractPartySize(text),
    location: query ? { query, radiusMiles } : radiusMiles ? { query: "", radiusMiles } : undefined,
    cuisines: extractCuisines(text),
    dietaryRequirements: extractDietary(text),
    price: extractPrice(text),
    requirements: extractRequirements(text),
    invitees: extractInvitees(text),
    missingFields: [],
    ambiguities: [],
    source: "natural-language"
  };
  if (intent.location && !intent.location.query && intent.location.radiusMiles == null) {
    intent.location = undefined;
  }
  intent.title = defaultTitle(intent);
  return stripPrivateCopy(intent, text);
}
