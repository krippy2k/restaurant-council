import { AppError, ErrorCodes } from "@rc/shared";
import type { LocationResolver, LocationSuggestion, ResolvedLocation } from "./domain.ts";
import { fetchWithTimeout } from "./http.ts";

export const KNOWN_PLACES: Array<ResolvedLocation & { aliases: string[] }> = [
  {
    displayName: "Times Square, New York, NY",
    latitude: 40.758,
    longitude: -73.9855,
    source: "landmark",
    aliases: ["new york", "nyc", "manhattan", "times square", "midtown"]
  },
  {
    displayName: "Brickell, Miami, FL",
    latitude: 25.7617,
    longitude: -80.1918,
    source: "neighborhood",
    aliases: ["brickell", "miami", "brickell miami"]
  },
  {
    displayName: "Downtown Austin, TX",
    latitude: 30.2672,
    longitude: -97.7431,
    source: "city",
    aliases: ["austin", "downtown austin"]
  },
  {
    displayName: "The Loop, Chicago, IL",
    latitude: 41.8781,
    longitude: -87.6298,
    source: "neighborhood",
    aliases: ["chicago", "the loop", "downtown chicago"]
  },
  {
    displayName: "Bamford Park, Broward County, FL",
    latitude: 26.1901,
    longitude: -80.2504,
    source: "landmark",
    aliases: [
      "bamford park",
      "bamford park broward",
      "bamford park in broward county",
      "bamford park, broward county, florida"
    ]
  },
  {
    displayName: "SoMa, San Francisco, CA",
    latitude: 37.7749,
    longitude: -122.4194,
    source: "neighborhood",
    aliases: ["san francisco", "sf", "soma"]
  }
];

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

export class MockLocationResolver implements LocationResolver {
  async suggest(query: string): Promise<LocationSuggestion[]> {
    const q = query.trim().toLowerCase();
    if (!q) return KNOWN_PLACES.slice(0, 5).map(toSuggestion);
    return KNOWN_PLACES.filter((place) =>
      place.aliases.some((alias) => alias.includes(q) || q.includes(alias)) ||
      place.displayName.toLowerCase().includes(q)
    ).map(toSuggestion);
  }

  async resolve(query: string): Promise<ResolvedLocation> {
    const coords = parseCoordinates(query);
    if (coords) return coords;
    const q = query.trim().toLowerCase();
    const match = KNOWN_PLACES.find(
      (place) =>
        place.aliases.some((alias) => alias === q || q.includes(alias)) ||
        place.displayName.toLowerCase() === q
    ) ?? KNOWN_PLACES.find((place) => place.aliases.some((alias) => alias.includes(q) || q.includes(alias)));
    if (!match) {
      throw new AppError(
        ErrorCodes.LOCATION_NOT_FOUND,
        `Could not resolve "${query}". Try a city, neighborhood, or coordinates.`,
        404
      );
    }
    const { aliases: _aliases, ...resolved } = match;
    return resolved;
  }
}

function toSuggestion(place: ResolvedLocation): LocationSuggestion {
  return {
    displayName: place.displayName,
    source: place.source,
    placeId: place.providerPlaceId
  };
}

export class GoogleLocationResolver implements LocationResolver {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly fallback = new MockLocationResolver()
  ) {}

  async suggest(query: string): Promise<LocationSuggestion[]> {
    const q = query.trim();
    if (q.length < 2) return this.fallback.suggest(q);
    try {
      const response = await fetchWithTimeout(this.fetchImpl, "https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": this.apiKey
        },
        body: JSON.stringify({ input: q, includedPrimaryTypes: ["locality", "neighborhood", "geocode", "park"] })
      });
      if (!response.ok) return this.fallback.suggest(q);
      const payload = (await response.json()) as {
        suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }>;
      };
      const suggestions = (payload.suggestions ?? [])
        .map((item) => ({
          displayName: item.placePrediction?.text?.text ?? "",
          placeId: item.placePrediction?.placeId,
          source: "address" as const
        }))
        .filter((item) => item.displayName);
      return suggestions.length ? suggestions : this.fallback.suggest(q);
    } catch {
      return this.fallback.suggest(q);
    }
  }

  async resolve(query: string, placeId?: string): Promise<ResolvedLocation> {
    const coords = parseCoordinates(query);
    if (coords) return coords;
    try {
      if (placeId) return await this.resolvePlace(placeId, query);
      const suggestions = await this.suggest(query);
      if (suggestions[0]?.placeId) {
        return await this.resolvePlace(suggestions[0].placeId, suggestions[0].displayName);
      }
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCodes.LOCATION_NOT_FOUND) {
        return this.fallback.resolve(query);
      }
    }
    return this.fallback.resolve(query);
  }

  private async resolvePlace(placeId: string, fallbackName: string): Promise<ResolvedLocation> {
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "id,displayName,formattedAddress,location,types"
        }
      }
    );
    if (!response.ok) {
      throw new AppError(ErrorCodes.LOCATION_NOT_FOUND, "Could not resolve that location.", 404);
    }
    const payload = (await response.json()) as {
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    };
    if (payload.location?.latitude == null || payload.location.longitude == null) {
      throw new AppError(ErrorCodes.LOCATION_NOT_FOUND, "Could not resolve that location.", 404);
    }
    return {
      displayName: payload.formattedAddress ?? payload.displayName?.text ?? fallbackName,
      latitude: payload.location.latitude,
      longitude: payload.location.longitude,
      source: "address",
      providerPlaceId: payload.id ?? placeId
    };
  }
}
