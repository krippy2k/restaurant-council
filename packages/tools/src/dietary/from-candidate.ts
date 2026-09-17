import type { RestaurantCandidate } from "@rc/protocol";
import type { Restaurant } from "../domain.ts";

export function candidateAsRestaurant(candidate: RestaurantCandidate): Restaurant {
  return {
    id: candidate.id,
    provider: "mock",
    providerId: candidate.id,
    name: candidate.name,
    address: candidate.address,
    location: { latitude: candidate.latitude, longitude: candidate.longitude },
    cuisines: candidate.cuisines,
    priceLevel: candidate.priceLevel,
    priceRange: candidate.priceRange,
    rating: candidate.rating,
    reviewCount: candidate.reviewCount,
    reviews: candidate.reviews?.map((review) => ({
      provider: review.provider,
      providerReviewId: review.providerReviewId,
      rating: review.rating,
      text: review.text,
      authorName: review.authorName,
      relativeTimeDescription: review.relativeTimeDescription,
      publishedAt: review.publishedAt,
      attribution: review.attribution
    })),
    website: candidate.website,
    phone: candidate.phone,
    email: candidate.email,
    attributes: {
      vegetarian: candidate.dietaryOptions?.includes("vegetarian"),
      outdoorSeating: candidate.outdoorSeating
    },
    openingHours: candidate.openingHours ??
      (candidate.hoursWeekdayText
        ? { weekdayText: candidate.hoursWeekdayText }
        : candidate.hours
          ? { weekdayText: [candidate.hours] }
          : undefined)
  };
}
