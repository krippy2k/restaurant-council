import type { LocationResolver, LocationSuggestion, ResolvedLocation } from "./domain.ts";
import { MockLocationResolver } from "./geocode.ts";

export interface ResolveLocationOutput {
  status: "resolved" | "ambiguous" | "not-found";
  location?: ResolvedLocation;
  candidates?: ResolvedLocation[];
}

const WEAK_TOKENS = new Set([
  "park",
  "inn",
  "hotel",
  "motel",
  "plaza",
  "place",
  "area",
  "city",
  "town",
  "county",
  "state",
  "near",
  "miles",
  "restaurant",
  "the",
  "and",
  "for"
]);

function parseCoordinates(query: string): ResolvedLocation | null {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    displayName: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    latitude,
    longitude,
    source: "coordinates"
  };
}

function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !WEAK_TOKENS.has(token));
}

export function locationMatchesQuery(displayName: string, query: string): boolean {
  const tokens = significantTokens(query);
  if (tokens.length === 0) return true;
  const name = displayName.toLowerCase();
  return tokens.some((token) => name.includes(token));
}

function suggestionKey(item: LocationSuggestion): string {
  return (item.placeId ?? item.displayName).trim().toLowerCase();
}

function coordinateKey(location: ResolvedLocation): string {
  return `${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
}

function uniqueSuggestions(suggestions: LocationSuggestion[]): LocationSuggestion[] {
  const seen = new Set<string>();
  const unique: LocationSuggestion[] = [];
  for (const item of suggestions) {
    const key = suggestionKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function uniqueLocations(locations: ResolvedLocation[]): ResolvedLocation[] {
  const seen = new Set<string>();
  const unique: ResolvedLocation[] = [];
  for (const location of locations) {
    const key = coordinateKey(location);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(location);
  }
  return unique;
}

function groundedSuggestions(suggestions: LocationSuggestion[], query: string): LocationSuggestion[] {
  return uniqueSuggestions(suggestions).filter((item) => locationMatchesQuery(item.displayName, query));
}

async function suggestionsFor(
  resolver: LocationResolver,
  query: string
): Promise<{ items: LocationSuggestion[]; via: "primary" | "mock" }> {
  const primary = groundedSuggestions(await resolver.suggest(query), query);
  if (primary.length) return { items: primary, via: "primary" };
  if (resolver instanceof MockLocationResolver) return { items: [], via: "primary" };
  return { items: groundedSuggestions(await new MockLocationResolver().suggest(query), query), via: "mock" };
}

async function resolveSuggestion(
  resolver: LocationResolver,
  item: LocationSuggestion,
  query: string
): Promise<ResolvedLocation | undefined> {
  try {
    const location = await resolver.resolve(item.displayName, item.placeId);
    if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
      return undefined;
    }
    return {
      ...location,
      displayName: locationMatchesQuery(item.displayName, query) ? item.displayName : location.displayName
    };
  } catch {
    return undefined;
  }
}

export async function resolveLocationQuery(
  resolver: LocationResolver,
  query: string
): Promise<ResolveLocationOutput> {
  const trimmed = query.trim();
  if (!trimmed) return { status: "not-found" };
  const coords = parseCoordinates(trimmed);
  if (coords) return { status: "resolved", location: coords };

  const { items: unique, via } = await suggestionsFor(resolver, trimmed);
  const lookup = via === "mock" ? new MockLocationResolver() : resolver;
  if (unique.length > 1) {
    const resolved = (
      await Promise.all(unique.slice(0, 6).map((item) => resolveSuggestion(lookup, item, trimmed)))
    ).filter((item): item is ResolvedLocation => Boolean(item));
    const distinct = uniqueLocations(resolved);
    if (distinct.length === 1) return { status: "resolved", location: distinct[0] };
    if (distinct.length > 1) return { status: "ambiguous", candidates: distinct };
    return { status: "not-found" };
  }

  if (unique[0]) {
    const location = await resolveSuggestion(lookup, unique[0], trimmed);
    if (location) return { status: "resolved", location };
  }

  try {
    const fallback = await new MockLocationResolver().resolve(trimmed);
    if (locationMatchesQuery(fallback.displayName, trimmed)) {
      return { status: "resolved", location: fallback };
    }
  } catch {
    // keep not-found
  }
  return { status: "not-found" };
}
