export const CARD_PHOTO_MAX_WIDTH = 800;
export const HERO_PHOTO_MAX_WIDTH = 1600;

export interface RestaurantPhoto {
  provider: "google" | "mock";
  providerPhotoId: string;
  width?: number;
  height?: number;
  attribution?: string;
}

export interface RestaurantReview {
  provider: "google" | "mock";
  providerReviewId?: string;
  rating?: number;
  text?: string;
  authorName?: string;
  relativeTimeDescription?: string;
  publishedAt?: string;
  attribution?: string;
}

export interface RestaurantView {
  id: string;
  name: string;
  priceLevel?: number;
  priceRange?: {
    startAmount?: number;
    endAmount?: number;
    currencyCode?: string;
  };
  rating?: number;
  reviewCount?: number;
  cuisines: string[];
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  distanceKm?: number;
  outdoorSeating?: boolean;
  dietaryOptions?: string[];
  accessibility?: string[];
  photos?: RestaurantPhoto[];
  reviews?: RestaurantReview[];
  providerAttribution?: string;
  dietaryAssessments?: Array<{
    restaurantId: string;
    requirement: string;
    status: "confirmed" | "likely" | "uncertain" | "unsupported" | "conflicting";
    confidence: number;
    evidence: Array<{
      id: string;
      sourceType: string;
      sourceUrl?: string;
      sourceName?: string;
      excerpt?: string;
      supports: "supports" | "contradicts" | "neutral";
      reliability: "high" | "medium" | "low";
    }>;
    analyzedAt: string;
    expiresAt?: string;
  }>;
}

export function restaurantPhotoUrl(
  restaurantId: string,
  photoId: string,
  width = CARD_PHOTO_MAX_WIDTH
): string {
  return `/api/restaurants/${encodeURIComponent(restaurantId)}/photos/${encodeURIComponent(photoId)}?w=${width}`;
}

function formatMoneyAmount(amount: number, currencyCode = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2
    }).format(amount);
  } catch {
    return `$${Math.round(amount)}`;
  }
}

export function formatRestaurantPrice(input: {
  priceLevel?: number;
  priceRange?: RestaurantView["priceRange"];
}): { primary: string; detail?: string } | undefined {
  const range = input.priceRange;
  const currency = range?.currencyCode || "USD";
  if (range?.startAmount != null && range.endAmount != null) {
    return {
      primary: `${formatMoneyAmount(range.startAmount, currency)}–${formatMoneyAmount(range.endAmount, currency)}`
    };
  }
  if (range?.startAmount != null) {
    return { primary: `${formatMoneyAmount(range.startAmount, currency)}+` };
  }
  if (range?.endAmount != null) {
    return { primary: `under ${formatMoneyAmount(range.endAmount, currency)}` };
  }
  const level = input.priceLevel;
  if (!level) return undefined;
  const symbols = "$".repeat(Math.min(4, Math.max(1, Math.round(level))));
  const detail =
    level === 1
      ? "typically under $15"
      : level === 2
        ? "typically $15–$30"
        : level === 3
          ? "typically $30–$60"
          : "typically $60+";
  return { primary: symbols, detail };
}

export function priceLabel(
  priceLevel?: number,
  priceRange?: RestaurantView["priceRange"]
): string {
  return formatRestaurantPrice({ priceLevel, priceRange })?.primary ?? "";
}

export function formatRatingLabel(rating?: number, reviewCount?: number): string {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return "No rating available";
  const stars = Math.round(rating * 10) / 10;
  if (reviewCount == null || !Number.isFinite(reviewCount) || reviewCount < 0) {
    return `★ ${stars.toFixed(1)}`;
  }
  return `★ ${stars.toFixed(1)} (${Math.round(reviewCount).toLocaleString("en-US")})`;
}

export function ratingAriaLabel(rating?: number, reviewCount?: number): string {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return "No rating available";
  const stars = Math.round(rating * 10) / 10;
  if (reviewCount == null || !Number.isFinite(reviewCount) || reviewCount < 0) {
    return `Rated ${stars.toFixed(1)} out of 5`;
  }
  return `Rated ${stars.toFixed(1)} out of 5 from ${Math.round(reviewCount).toLocaleString("en-US")} ratings`;
}

export function photoAlt(restaurantName: string): string {
  return `Photo of ${restaurantName}`;
}

export function selectPrimaryPhoto(photos: RestaurantPhoto[] | undefined): RestaurantPhoto | undefined {
  if (!photos?.length) return undefined;
  return (
    photos.find((photo) => photo.width != null && photo.height != null && photo.width >= photo.height) ??
    photos[0]
  );
}

export function phoneHref(phone: string): string {
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return `tel:${trimmed}`;
  return plus ? `tel:+${digits}` : `tel:${digits}`;
}

export function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}
