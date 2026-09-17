import type { RestaurantCandidate } from "@rc/protocol";
import { mergePhotos } from "@rc/tools";

/** Keep photos, reviews, and contact when a later candidate copy is thinner. */
export function mergeRestaurantMedia(
  primary: RestaurantCandidate,
  fallback?: RestaurantCandidate
): RestaurantCandidate {
  if (!fallback) {
    return {
      ...primary,
      photos: mergePhotos(primary.photos),
      reviews: primary.reviews?.length ? primary.reviews : undefined
    };
  }
  return {
    ...fallback,
    ...primary,
    photos: mergePhotos(primary.photos, fallback.photos),
    reviews: primary.reviews?.length ? primary.reviews : fallback.reviews,
    phone: primary.phone ?? fallback.phone,
    email: primary.email ?? fallback.email,
    website: primary.website ?? fallback.website,
    address: primary.address ?? fallback.address,
    hours: primary.hours ?? fallback.hours,
    hoursWeekdayText: primary.hoursWeekdayText ?? fallback.hoursWeekdayText,
    openingHours: primary.openingHours ?? fallback.openingHours,
    hoursAssessment: primary.hoursAssessment ?? fallback.hoursAssessment,
    rating: primary.rating ?? fallback.rating,
    reviewCount: primary.reviewCount ?? fallback.reviewCount,
    priceRange: primary.priceRange ?? fallback.priceRange,
    providerAttribution: primary.providerAttribution ?? fallback.providerAttribution,
    dietaryAssessments: primary.dietaryAssessments ?? fallback.dietaryAssessments
  };
}

export function mediaByRestaurantId(snapshot: {
  candidates: RestaurantCandidate[];
  recommendations: Array<{ candidate: RestaurantCandidate }>;
}): Map<string, RestaurantCandidate> {
  const byId = new Map<string, RestaurantCandidate>();
  for (const candidate of snapshot.candidates) {
    byId.set(candidate.id, mergeRestaurantMedia(candidate, byId.get(candidate.id)));
  }
  for (const recommendation of snapshot.recommendations) {
    byId.set(
      recommendation.candidate.id,
      mergeRestaurantMedia(recommendation.candidate, byId.get(recommendation.candidate.id))
    );
  }
  return byId;
}
