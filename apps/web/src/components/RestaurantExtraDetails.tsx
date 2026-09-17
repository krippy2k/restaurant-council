import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { selectPrimaryPhoto, type RestaurantView } from "../restaurant-display";
import { RestaurantGallery } from "./RestaurantGallery";
import { RestaurantReviewList } from "./RestaurantReviewList";

function needsDetails(restaurant: RestaurantView): boolean {
  return (restaurant.photos?.length ?? 0) < 2 || !(restaurant.reviews?.length);
}

function mergeDetails(base: RestaurantView, details: RestaurantView): RestaurantView {
  return {
    ...base,
    ...details,
    photos:
      (details.photos?.length ?? 0) >= (base.photos?.length ?? 0) ? details.photos : base.photos,
    reviews: details.reviews?.length ? details.reviews : base.reviews,
    providerAttribution: details.providerAttribution ?? base.providerAttribution
  };
}

export function RestaurantExtraDetails({ restaurant }: { restaurant: RestaurantView }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(restaurant);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const fetchedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    setLoaded((current) => (current.id === restaurant.id ? mergeDetails(current, restaurant) : restaurant));
    if (fetchedFor.current !== restaurant.id) {
      fetchedFor.current = undefined;
      setError(undefined);
    }
  }, [restaurant]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || fetchedFor.current === restaurant.id || !needsDetails(loaded)) return;
    fetchedFor.current = restaurant.id;
    setBusy(true);
    setError(undefined);
    try {
      const data = await api.restaurantDetails(restaurant.id);
      setLoaded((current) => mergeDetails(current, data.restaurant));
    } catch (err) {
      fetchedFor.current = undefined;
      setError(err instanceof Error ? err.message : "Could not load restaurant details.");
    } finally {
      setBusy(false);
    }
  }

  const photo = selectPrimaryPhoto(loaded.photos);
  const extraPhotos = (loaded.photos ?? []).slice(1);
  const hasContent = Boolean(extraPhotos.length || loaded.reviews?.length);

  return (
    <>
      <div className="resto-details-toggle">
        <button
          className="btn secondary resto-details-toggle-btn"
          type="button"
          onClick={() => void toggle()}
        >
          {open ? "Hide details" : "View details"}
        </button>
      </div>
      {open ? (
        <div className="resto-detail-panel">
          {busy ? <p className="muted">Loading photos and reviews…</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {extraPhotos.length ? (
            <RestaurantGallery
              restaurantId={loaded.id}
              restaurantName={loaded.name}
              photos={extraPhotos}
            />
          ) : null}
          <RestaurantReviewList reviews={loaded.reviews} />
          {!busy && !error && !hasContent ? (
            <p className="muted">No extra photos or reviews for this restaurant.</p>
          ) : null}
          {photo?.attribution ? <p className="muted">{photo.attribution}</p> : null}
          {loaded.providerAttribution ? <p className="muted">{loaded.providerAttribution}</p> : null}
        </div>
      ) : null}
    </>
  );
}
