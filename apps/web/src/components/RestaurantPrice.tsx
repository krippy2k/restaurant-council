import { formatRestaurantPrice, type RestaurantView } from "../restaurant-display";

export function RestaurantPrice({
  priceLevel,
  priceRange
}: {
  priceLevel?: number;
  priceRange?: RestaurantView["priceRange"];
}) {
  const price = formatRestaurantPrice({ priceLevel, priceRange });
  if (!price) return null;
  const label = price.detail ? `${price.primary} · ${price.detail}` : price.primary;
  return (
    <span className="resto-price" title={label} aria-label={label}>
      {price.primary}
      {price.detail ? <span className="muted"> · {price.detail}</span> : null}
    </span>
  );
}
