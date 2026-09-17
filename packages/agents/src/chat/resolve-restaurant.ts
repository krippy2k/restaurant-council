export interface NamedRestaurant {
  id: string;
  name: string;
  address?: string;
}

export type RestaurantResolution =
  | { status: "resolved"; restaurants: NamedRestaurant[] }
  | { status: "ambiguous"; restaurants: NamedRestaurant[]; message: string }
  | { status: "unresolved"; restaurants: []; message: string };

const DEICTIC = /\b(this place|this restaurant|that place|here|their|them|it)\b/i;
const COMPARE = /\b(which of (these|those|the finalists)|which restaurants|which places|any of these)\b/i;
const FOLLOW_UP_NAME = /^(?:what about|how about|and|also)\s+(.+?)\??$/i;

export function normalizeRestaurantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_NAME_TOKENS = new Set([
  "bar",
  "cafe",
  "diner",
  "food",
  "grill",
  "house",
  "kitchen",
  "pizza",
  "restaurant",
  "taco",
  "tacos"
]);

function significantNameTokens(name: string): string[] {
  return normalizeRestaurantName(name).split(" ").filter((token) => token.length > 2);
}

function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (!needle.length || haystack.length < needle.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((token, offset) => haystack[i + offset] === token)) return true;
  }
  return false;
}

function consecutiveNameOverlap(nameTokens: string[], queryTokens: string[]): number {
  for (let length = nameTokens.length; length >= 1; length--) {
    for (let start = 0; start <= nameTokens.length - length; start++) {
      if (containsTokenSequence(queryTokens, nameTokens.slice(start, start + length))) {
        return length;
      }
    }
  }
  return 0;
}

export function extractExplicitNames(query: string, candidates: NamedRestaurant[]): NamedRestaurant[] {
  const q = normalizeRestaurantName(query);
  const qRaw = query.toLowerCase();
  const queryTokens = significantNameTokens(query);
  const scored: Array<{ restaurant: NamedRestaurant; score: number }> = [];
  for (const restaurant of candidates) {
    const n = normalizeRestaurantName(restaurant.name);
    if (!n || n.length < 3) continue;
    const tokens = significantNameTokens(restaurant.name);
    const overlap = consecutiveNameOverlap(tokens, queryTokens);
    const fullName =
      qRaw.includes(restaurant.name.toLowerCase()) ||
      q.includes(n) ||
      (tokens.length > 0 && tokens.every((token) => q.includes(token)));
    let score = 0;
    if (fullName) score = Math.max(tokens.length, 2);
    if (overlap >= 2) score = Math.max(score, overlap);
    if (overlap === 1) {
      const matched = tokens.find(
        (token) =>
          queryTokens.includes(token) && token.length >= 5 && !GENERIC_NAME_TOKENS.has(token)
      );
      const unique =
        Boolean(matched) &&
        candidates.filter((item) => significantNameTokens(item.name).includes(matched!)).length === 1;
      if (unique) score = Math.max(score, 1);
    }
    if (score > 0) scored.push({ restaurant, score });
  }
  if (!scored.length) return [];
  const best = Math.max(...scored.map((item) => item.score));
  return scored.filter((item) => item.score === best).map((item) => item.restaurant);
}

export function resolveRestaurants(input: {
  query: string;
  candidates: NamedRestaurant[];
  selectedId?: string;
  recentRestaurantIds?: string[];
  finalistIds?: string[];
}): RestaurantResolution {
  const { query, candidates } = input;
  if (!candidates.length) {
    return { status: "unresolved", restaurants: [], message: "There are no restaurants in this event to research yet." };
  }

  const named = extractExplicitNames(query, candidates);
  if (named.length === 1) return { status: "resolved", restaurants: named };
  if (named.length > 1) {
    const sameName = named.every((item) => normalizeRestaurantName(item.name) === normalizeRestaurantName(named[0].name));
    if (sameName) {
      return {
        status: "ambiguous",
        restaurants: named,
        message: `I found more than one ${named[0].name}. Which location did you mean? ${named
          .map((item) => item.address ?? item.id)
          .join("; ")}`
      };
    }
    return { status: "resolved", restaurants: named };
  }

  const follow = FOLLOW_UP_NAME.exec(query.trim());
  if (follow) {
    const fromFollow = extractExplicitNames(follow[1], candidates);
    if (fromFollow.length === 1) return { status: "resolved", restaurants: fromFollow };
    if (fromFollow.length > 1) {
      return {
        status: "ambiguous",
        restaurants: fromFollow,
        message: "Which restaurant did you mean?"
      };
    }
  }

  if (COMPARE.test(query)) {
    const finalists = candidates.filter((item) => input.finalistIds?.includes(item.id));
    const set = (finalists.length ? finalists : candidates).slice(0, 8);
    return { status: "resolved", restaurants: set };
  }

  if (DEICTIC.test(query)) {
    const id = input.selectedId ?? input.recentRestaurantIds?.[0];
    const restaurant = candidates.find((item) => item.id === id);
    if (restaurant) return { status: "resolved", restaurants: [restaurant] };
    if (candidates.length === 1) return { status: "resolved", restaurants: candidates };
    return {
      status: "unresolved",
      restaurants: [],
      message: "Which restaurant should I look at? Name one of the event restaurants."
    };
  }

  if (candidates.length === 1) return { status: "resolved", restaurants: candidates };

  if (input.selectedId) {
    const selected = candidates.find((item) => item.id === input.selectedId);
    if (selected) return { status: "resolved", restaurants: [selected] };
  }

  return {
    status: "unresolved",
    restaurants: [],
    message: "Which restaurant should I research? Name one from this event, or say “this place” while discussing one."
  };
}

export function carryForwardQuery(currentQuery: string, previousQuery?: string): string {
  if (!previousQuery?.trim()) return currentQuery;
  const follow = FOLLOW_UP_NAME.exec(currentQuery.trim());
  if (!follow) return currentQuery;
  const nextName = follow[1].replace(/\?+$/, "").trim();
  const previousNames = previousQuery.match(
    /\b[A-Z][A-Za-z0-9'&.]*(?:\s+[A-Z][A-Za-z0-9'&.]*)*\b/g
  );
  if (previousNames?.[0]) {
    return previousQuery.replace(previousNames[0], nextName);
  }
  return `Regarding ${nextName}: ${previousQuery}`;
}
