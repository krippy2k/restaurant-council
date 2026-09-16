import type { EventSearchArea } from "@rc/domain";
import type { CouncilConstraint } from "@rc/protocol";
import { dietaryRequirementIds } from "@rc/protocol";
import { AppError, ErrorCodes } from "@rc/shared";
import {
  clampRadiusMeters,
  DEFAULT_RADIUS_METERS,
  MAX_SEARCH_LIMIT,
  type RestaurantSearchRequest
} from "./domain.ts";

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function isRequired(constraint: CouncilConstraint): boolean {
  return constraint.priority === "HARD";
}

export function searchAreaFromEvent(input: {
  searchArea?: EventSearchArea;
  location?: { latitude: number; longitude: number };
  locationLabel?: string;
}): EventSearchArea {
  if (input.searchArea) {
    return {
      ...input.searchArea,
      radiusMeters: clampRadiusMeters(input.searchArea.radiusMeters)
    };
  }
  const location = input.location ?? { latitude: 40.758, longitude: -73.9855 };
  return {
    displayName: input.locationLabel ?? "Search area",
    latitude: location.latitude,
    longitude: location.longitude,
    radiusMeters: DEFAULT_RADIUS_METERS,
    source: "city"
  };
}

/**
 * Builds a provider search from sanitized Council constraints only.
 * Never copies preference source text.
 */
export function buildSearchRequest(
  area: EventSearchArea,
  constraints: CouncilConstraint[]
): RestaurantSearchRequest {
  const cuisines: string[] = [];
  const requiredCuisines: string[] = [];
  const dietary: string[] = [];
  const requiredDietary: string[] = [];
  const attributes: string[] = [];
  let preferredMaxPrice: number | undefined;
  let requiredMaxPrice: number | undefined;
  let requiredRadiusKm: number | undefined;
  let preferredRadiusKm: number | undefined;

  for (const constraint of constraints) {
    switch (constraint.type) {
      case "CUISINE_PREFER":
        cuisines.push(...asStringArray(constraint.value));
        if (isRequired(constraint)) requiredCuisines.push(...asStringArray(constraint.value));
        break;
      case "DIETARY":
        dietary.push(...dietaryRequirementIds(constraint.value));
        if (isRequired(constraint)) requiredDietary.push(...dietaryRequirementIds(constraint.value));
        break;
      case "MAX_PRICE_LEVEL": {
        const max = Number(constraint.value);
        if (!Number.isFinite(max)) break;
        if (isRequired(constraint)) {
          requiredMaxPrice = Math.min(requiredMaxPrice ?? 4, max);
        } else {
          preferredMaxPrice = Math.min(preferredMaxPrice ?? 4, max);
        }
        break;
      }
      case "MAX_DISTANCE_KM": {
        const km = Number(constraint.value);
        if (!Number.isFinite(km) || km <= 0) break;
        if (isRequired(constraint)) {
          requiredRadiusKm = Math.min(requiredRadiusKm ?? km, km);
        } else {
          preferredRadiusKm = Math.min(preferredRadiusKm ?? km, km);
        }
        break;
      }
      case "OUTDOOR_SEATING":
        if (constraint.value === true) attributes.push("outdoor-seating");
        break;
      default:
        break;
    }
  }

  const maxPrice = requiredMaxPrice ?? preferredMaxPrice;
  const radiusMeters = clampRadiusMeters(
    requiredRadiusKm != null
      ? requiredRadiusKm * 1000
      : preferredRadiusKm != null
        ? preferredRadiusKm * 1000
        : area.radiusMeters
  );

  return {
    location: { latitude: area.latitude, longitude: area.longitude },
    radiusMeters,
    cuisines: cuisines.length ? [...new Set(cuisines.map((item) => item.toLowerCase()))] : undefined,
    priceLevels: maxPrice != null ? range(1, Math.max(1, Math.min(4, Math.round(maxPrice)))) : undefined,
    dietaryRequirements: dietary.length
      ? [...new Set(dietary.map((item) => item.toLowerCase()))]
      : undefined,
    attributes: attributes.length ? [...new Set(attributes)] : undefined,
    limit: MAX_SEARCH_LIMIT,
    required: {
      dietaryRequirements: requiredDietary.length
        ? [...new Set(requiredDietary.map((item) => item.toLowerCase()))]
        : undefined,
      maxPriceLevel: requiredMaxPrice,
      maxRadiusMeters: requiredRadiusKm != null ? clampRadiusMeters(requiredRadiusKm * 1000) : undefined,
      cuisines: requiredCuisines.length
        ? [...new Set(requiredCuisines.map((item) => item.toLowerCase()))]
        : undefined
    }
  };
}

function range(from: number, to: number): number[] {
  const values = [];
  for (let i = from; i <= to; i += 1) values.push(i);
  return values;
}

export function validateSearchRequest(input: unknown): RestaurantSearchRequest {
  if (!input || typeof input !== "object") {
    throw new AppError(ErrorCodes.VALIDATION, "Search request is required", 400);
  }
  const raw = input as Record<string, unknown>;
  const location = raw.location as Record<string, unknown> | undefined;
  const latitude = Number(location?.latitude ?? raw.latitude);
  const longitude = Number(location?.longitude ?? raw.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new AppError(ErrorCodes.VALIDATION, "latitude and longitude are required", 400);
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new AppError(ErrorCodes.VALIDATION, "latitude/longitude are out of range", 400);
  }
  let radiusMeters = DEFAULT_RADIUS_METERS;
  if (raw.radiusMeters != null) radiusMeters = Number(raw.radiusMeters);
  else if (raw.radiusKm != null) radiusMeters = Number(raw.radiusKm) * 1000;
  if (!Number.isFinite(radiusMeters)) {
    throw new AppError(ErrorCodes.VALIDATION, "radius is invalid", 400);
  }
  const request: RestaurantSearchRequest = {
    location: { latitude, longitude },
    radiusMeters: clampRadiusMeters(radiusMeters),
    cuisines: Array.isArray(raw.cuisines) ? raw.cuisines.map(String) : undefined,
    priceLevels: Array.isArray(raw.priceLevels)
      ? raw.priceLevels.map(Number).filter((n) => n >= 1 && n <= 4)
      : undefined,
    dietaryRequirements: Array.isArray(raw.dietaryRequirements)
      ? raw.dietaryRequirements.map(String)
      : undefined,
    attributes: Array.isArray(raw.attributes) ? raw.attributes.map(String) : undefined,
    textQuery: typeof raw.textQuery === "string" ? raw.textQuery.slice(0, 120) : undefined,
    limit: Math.min(MAX_SEARCH_LIMIT, Math.max(1, Number(raw.limit ?? MAX_SEARCH_LIMIT))),
    required: isRequiredBlock(raw.required) ? raw.required : undefined,
    relaxation: Array.isArray(raw.relaxation) ? raw.relaxation.map(String) : undefined
  };
  return request;
}

function isRequiredBlock(value: unknown): value is RestaurantSearchRequest["required"] {
  return Boolean(value) && typeof value === "object";
}
