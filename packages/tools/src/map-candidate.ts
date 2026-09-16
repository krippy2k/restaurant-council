import type { RestaurantCandidate } from "@rc/protocol";
import { haversineKm } from "./geo.ts";
import type { Restaurant } from "./domain.ts";
import { DETAIL_REVIEW_LIMIT, FINALIST_PHOTO_LIMIT, SEARCH_PHOTO_LIMIT } from "./domain.ts";
import { limitPhotos } from "./enrichment.ts";

export function restaurantToCandidate(
  restaurant: Restaurant,
  origin?: { latitude: number; longitude: number },
  options?: { details?: boolean }
): RestaurantCandidate {
  const dietary = [
    ...(restaurant.attributes?.vegetarian ? ["vegetarian"] : []),
    ...(restaurant.cuisines.some((item) => /vegan/i.test(item)) ? ["vegan"] : [])
  ];
  const photoLimit = options?.details ? FINALIST_PHOTO_LIMIT : SEARCH_PHOTO_LIMIT;
  return {
    id: restaurant.id,
    name: restaurant.name,
    priceLevel: restaurant.priceLevel,
    priceRange: restaurant.priceRange,
    rating: restaurant.rating,
    cuisines: restaurant.cuisines,
    latitude: restaurant.location.latitude,
    longitude: restaurant.location.longitude,
    distanceKm: origin
      ? Math.round(haversineKm(origin, restaurant.location) * 10) / 10
      : undefined,
    outdoorSeating: restaurant.attributes?.outdoorSeating,
    dietaryOptions: dietary.length ? dietary : restaurant.cuisines.filter((item) =>
      /vegetarian|vegan|gluten/i.test(item)
    ),
    address: restaurant.address,
    hours: restaurant.openingHours?.weekdayText?.[0],
    website: restaurant.website,
    phone: restaurant.phone,
    email: restaurant.email,
    reviewCount: restaurant.reviewCount,
    photos: limitPhotos(restaurant.photos, photoLimit),
    reviews: options?.details ? restaurant.reviews?.slice(0, DETAIL_REVIEW_LIMIT) : undefined,
    providerAttribution: restaurant.providerAttribution
  };
}
