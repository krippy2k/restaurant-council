import type { ReactNode } from "react";
import type { RestaurantView } from "../restaurant-display";
import {
  CARD_PHOTO_MAX_WIDTH,
  restaurantPhotoUrl,
  selectPrimaryPhoto
} from "../restaurant-display";
import { DietaryCompatibility } from "./DietaryCompatibility";
import { RestaurantContact } from "./RestaurantContact";
import { RestaurantPhoto } from "./RestaurantPhoto";
import { RestaurantPrice } from "./RestaurantPrice";
import { RestaurantRating } from "./RestaurantRating";

export function RestaurantCard({
  restaurant,
  kicker,
  children,
  compact = false
}: {
  restaurant: RestaurantView;
  kicker?: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  const photo = selectPrimaryPhoto(restaurant.photos);
  const cuisine = restaurant.cuisines[0] ?? "Restaurant";
  const distance =
    restaurant.distanceKm != null ? `${restaurant.distanceKm} mi` : undefined;
  return (
    <article className={`resto-card ${compact ? "compact" : ""}`}>
      <RestaurantPhoto
        src={
          photo
            ? restaurantPhotoUrl(restaurant.id, photo.providerPhotoId, CARD_PHOTO_MAX_WIDTH)
            : undefined
        }
        name={restaurant.name}
        className={compact ? "photo-card" : "photo-hero"}
        width={CARD_PHOTO_MAX_WIDTH}
        sizes={compact ? "(max-width: 800px) 100vw, 320px" : "(max-width: 800px) 100vw, 640px"}
      />
      <div className="resto-card-body">
        {kicker ? <div className="kicker">{kicker}</div> : null}
        <h2>{restaurant.name}</h2>
        <p className="resto-meta">
          <RestaurantRating rating={restaurant.rating} reviewCount={restaurant.reviewCount} />
          <RestaurantPrice priceLevel={restaurant.priceLevel} priceRange={restaurant.priceRange} />
        </p>
        <p className="muted">
          {cuisine}
          {distance ? ` · ${distance}` : ""}
          {restaurant.address ? ` · ${restaurant.address}` : ""}
        </p>
        <RestaurantContact restaurant={restaurant} compact />
        <DietaryCompatibility restaurant={restaurant} compact />
        {children}
        {photo?.attribution ? <p className="muted photo-attr">{photo.attribution}</p> : null}
        {restaurant.providerAttribution ? (
          <p className="muted photo-attr">{restaurant.providerAttribution}</p>
        ) : null}
      </div>
    </article>
  );
}
