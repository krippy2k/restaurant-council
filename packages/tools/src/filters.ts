import { haversineKm } from "./geo.ts";
import type { Restaurant, RestaurantSearchRequest } from "./domain.ts";
import { metersToKm } from "./domain.ts";
import { reputationScore } from "./enrichment.ts";

function asLower(values: string[] | undefined): string[] {
  return (values ?? []).map((item) => item.toLowerCase());
}

function cuisineMatch(restaurant: Restaurant, wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  const haystack = [
    ...restaurant.cuisines,
    restaurant.primaryType ?? "",
    restaurant.name
  ].map((item) => item.toLowerCase());
  return wanted.some((item) => haystack.some((value) => value.includes(item)));
}

export function applyDeterministicFilters(
  restaurants: Restaurant[],
  request: RestaurantSearchRequest
): Restaurant[] {
  const origin = request.location;
  const radiusKm = metersToKm(request.radiusMeters);
  const required = request.required ?? {};
  const maxPrice = required.maxPriceLevel;
  const requiredDietary = asLower(required.dietaryRequirements);
  const requiredCuisines = asLower(required.cuisines);
  const avoidAttrs = asLower(request.attributes).filter((item) => item.startsWith("avoid:"));

  return restaurants.filter((restaurant) => {
    const distanceKm = haversineKm(origin, restaurant.location);
    if (distanceKm > radiusKm + 0.05) return false;
    if (maxPrice != null && restaurant.priceLevel != null && restaurant.priceLevel > maxPrice) {
      return false;
    }
    if (requiredCuisines.length && !cuisineMatch(restaurant, requiredCuisines)) return false;
    if (requiredDietary.length) {
      const vegetarianRequired = requiredDietary.some((item) =>
        item === "vegetarian" || item === "vegetarian-options" || item === "vegan"
      );
      const onlyStructured = requiredDietary.every((item) =>
        item === "vegetarian" || item === "vegetarian-options" || item === "vegan"
      );
      if (vegetarianRequired && onlyStructured) {
        const options = [
          ...(restaurant.cuisines ?? []),
          restaurant.attributes?.vegetarian ? "vegetarian" : "",
          restaurant.primaryType === "vegan_restaurant" ? "vegan" : ""
        ].map((item) => item.toLowerCase());
        if (requiredDietary.includes("vegan") && !options.some((item) => item.includes("vegan"))) {
          return false;
        }
        if (
          (requiredDietary.includes("vegetarian") || requiredDietary.includes("vegetarian-options")) &&
          !options.some((item) => item.includes("vegetarian") || item.includes("vegan"))
        ) {
          return false;
        }
      }
    }
    if (avoidAttrs.includes("avoid:alcohol") && restaurant.attributes?.servesAlcohol) return false;
    return true;
  });
}

export function rankBySoftConstraints(
  restaurants: Restaurant[],
  request: RestaurantSearchRequest
): Restaurant[] {
  const preferredCuisines = asLower(request.cuisines);
  const preferredPrices = request.priceLevels ?? [];
  const outdoor = asLower(request.attributes).includes("outdoor-seating");
  const origin = request.location;

  return [...restaurants].sort((a, b) => {
    const score = (restaurant: Restaurant) => {
      let value = 0;
      if (preferredCuisines.length && cuisineMatch(restaurant, preferredCuisines)) value += 8;
      if (preferredPrices.length && restaurant.priceLevel != null) {
        if (preferredPrices.includes(restaurant.priceLevel)) value += 6;
      }
      if (outdoor && restaurant.attributes?.outdoorSeating) value += 3;
      value += reputationScore(restaurant.rating, restaurant.reviewCount);
      value -= haversineKm(origin, restaurant.location) * 0.2;
      return value;
    };
    return score(b) - score(a);
  });
}

export function broadenSearchRequest(
  request: RestaurantSearchRequest
): RestaurantSearchRequest | null {
  const relaxation = [...(request.relaxation ?? [])];
  const required = request.required ?? {};

  if ((request.cuisines?.length ?? 0) > 0 && !required.cuisines?.length) {
    return {
      ...request,
      cuisines: undefined,
      relaxation: [...relaxation, "Dropped preferred cuisine filter"]
    };
  }

  if (!required.maxRadiusMeters) {
    const nextRadius = Math.round(request.radiusMeters * 1.4);
    if (nextRadius > request.radiusMeters) {
      return {
        ...request,
        radiusMeters: Math.min(50_000, nextRadius),
        relaxation: [...relaxation, `Expanded radius to ${Math.min(50_000, nextRadius)}m`]
      };
    }
  }

  if (!required.maxPriceLevel && request.priceLevels?.length) {
    const max = Math.max(...request.priceLevels);
    if (max < 4) {
      const priceLevels = [...new Set([...request.priceLevels, max + 1])].sort();
      return {
        ...request,
        priceLevels,
        relaxation: [...relaxation, `Included price level ${max + 1}`]
      };
    }
  }

  return null;
}
