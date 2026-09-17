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

export function extractExplicitNames(query: string, candidates: NamedRestaurant[]): NamedRestaurant[] {
  const q = normalizeRestaurantName(query);
  const qRaw = query.toLowerCase();
  const matches: NamedRestaurant[] = [];
  for (const restaurant of candidates) {
    const n = normalizeRestaurantName(restaurant.name);
    if (!n || n.length < 3) continue;
    const tokens = n.split(" ").filter((token) => token.length > 2);
    const named =
      qRaw.includes(restaurant.name.toLowerCase()) ||
      q.includes(n) ||
      (tokens.length > 0 && tokens.every((token) => q.includes(token)));
    if (named) matches.push(restaurant);
  }
  return matches;
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
  const previousNames = previousQuery.match(/\b[A-Z][A-Za-z0-9'&. ]{2,40}\b/g);
  if (previousNames?.[0]) {
    return previousQuery.replace(previousNames[0], nextName);
  }
  return `Regarding ${nextName}: ${previousQuery}`;
}
