import type { RestaurantReview } from "../restaurant-display";

export function RestaurantReviewList({ reviews }: { reviews?: RestaurantReview[] }) {
  if (!reviews?.length) return null;
  return (
    <section className="resto-reviews">
      <h3>What diners are saying</h3>
      <ul>
        {reviews.map((review, index) => (
          <li key={review.providerReviewId ?? `${review.authorName ?? "review"}-${index}`}>
            {review.rating != null ? (
              <div className="resto-stars" aria-label={`Rated ${review.rating} out of 5`}>
                {"★".repeat(Math.max(0, Math.min(5, Math.round(review.rating))))}
                {"☆".repeat(Math.max(0, 5 - Math.round(review.rating)))}
              </div>
            ) : null}
            {review.text ? <p>“{review.text}”</p> : null}
            {review.authorName ? <cite>— {review.authorName}</cite> : null}
            {review.relativeTimeDescription ? (
              <span className="muted"> {review.relativeTimeDescription}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
