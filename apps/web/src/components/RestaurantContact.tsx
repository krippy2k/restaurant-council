import { phoneHref, websiteLabel, type RestaurantView } from "../restaurant-display";

export function RestaurantContact({
  restaurant,
  compact = false
}: {
  restaurant: RestaurantView;
  compact?: boolean;
}) {
  const items: Array<{ href: string; label: string; external?: boolean }> = [];
  if (restaurant.phone) {
    items.push({ href: phoneHref(restaurant.phone), label: restaurant.phone });
  }
  if (restaurant.email) {
    items.push({ href: `mailto:${restaurant.email}`, label: restaurant.email });
  }
  if (restaurant.website) {
    items.push({ href: restaurant.website, label: websiteLabel(restaurant.website), external: true });
  }
  if (!items.length) return null;
  return (
    <p className={`resto-contact ${compact ? "compact" : ""}`}>
      {items.map((item, index) => (
        <span key={item.href}>
          {index > 0 ? " · " : null}
          <a href={item.href} {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}>
            {item.label}
          </a>
        </span>
      ))}
    </p>
  );
}
