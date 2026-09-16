import type { RestaurantProviderType } from "./domain.ts";

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Stable Restaurant Council ID. Never uses the raw Google Place ID as the primary key. */
export function restaurantCouncilId(
  provider: RestaurantProviderType,
  providerId: string
): string {
  return `res_${djb2(`${provider}:${providerId}`)}`;
}

export function searchCacheKey(
  provider: RestaurantProviderType,
  request: {
    location: { latitude: number; longitude: number };
    radiusMeters: number;
    cuisines?: string[];
    priceLevels?: number[];
    dietaryRequirements?: string[];
    attributes?: string[];
    textQuery?: string;
    limit?: number;
  }
): string {
  const lat = request.location.latitude.toFixed(3);
  const lng = request.location.longitude.toFixed(3);
  const radius = Math.round(request.radiusMeters / 250) * 250;
  const parts = [
    provider,
    lat,
    lng,
    String(radius),
    (request.cuisines ?? []).map((item) => item.toLowerCase()).sort().join(","),
    (request.priceLevels ?? []).slice().sort().join(","),
    (request.dietaryRequirements ?? []).map((item) => item.toLowerCase()).sort().join(","),
    (request.attributes ?? []).map((item) => item.toLowerCase()).sort().join(","),
    (request.textQuery ?? "").trim().toLowerCase(),
    String(request.limit ?? "")
  ];
  return `search:${parts.join("|")}`;
}
