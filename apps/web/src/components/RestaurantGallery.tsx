import type { RestaurantPhoto as Photo } from "../restaurant-display";
import { CARD_PHOTO_MAX_WIDTH, restaurantPhotoUrl } from "../restaurant-display";
import { RestaurantPhoto } from "./RestaurantPhoto";

export function RestaurantGallery({
  restaurantId,
  restaurantName,
  photos
}: {
  restaurantId: string;
  restaurantName: string;
  photos?: Photo[];
}) {
  if (!photos?.length) return null;
  return (
    <div className="resto-gallery" role="list">
      {photos.map((photo) => (
        <div className="resto-gallery-item" role="listitem" key={photo.providerPhotoId} tabIndex={0}>
          <RestaurantPhoto
            src={restaurantPhotoUrl(restaurantId, photo.providerPhotoId, CARD_PHOTO_MAX_WIDTH)}
            name={restaurantName}
            width={CARD_PHOTO_MAX_WIDTH}
          />
          {photo.attribution ? <span className="muted">{photo.attribution}</span> : null}
        </div>
      ))}
    </div>
  );
}
