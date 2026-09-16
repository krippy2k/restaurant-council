import { formatRatingLabel, ratingAriaLabel } from "../restaurant-display";

export function RestaurantRating({
  rating,
  reviewCount
}: {
  rating?: number;
  reviewCount?: number;
}) {
  return (
    <span className="resto-rating" aria-label={ratingAriaLabel(rating, reviewCount)}>
      {formatRatingLabel(rating, reviewCount)}
    </span>
  );
}
