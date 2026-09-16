import type { RestaurantPhoto, RestaurantPhotoOptions } from "./domain.ts";
import { PROVIDER_PHOTO_MAX_PX } from "./domain.ts";

export function normalizeRating(value: unknown): number | undefined {
  const rating = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(rating) || rating <= 0) return undefined;
  return Math.round(Math.min(5, rating) * 10) / 10;
}

export function normalizeReviewCount(value: unknown): number | undefined {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count) || count < 0) return undefined;
  return Math.round(count);
}

export function clampPhotoDimension(value: number | undefined, fallback = 800): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(PROVIDER_PHOTO_MAX_PX, Math.max(1, Math.round(value)));
}

export function photoOptions(options?: RestaurantPhotoOptions): { maxWidth: number; maxHeight?: number } {
  return {
    maxWidth: clampPhotoDimension(options?.maxWidth, 800),
    maxHeight: options?.maxHeight != null ? clampPhotoDimension(options.maxHeight) : undefined
  };
}

export function selectPrimaryPhoto(photos: RestaurantPhoto[] | undefined): RestaurantPhoto | undefined {
  if (!photos?.length) return undefined;
  const landscape = photos.find(
    (photo) => photo.width != null && photo.height != null && photo.width >= photo.height
  );
  return landscape ?? photos[0];
}

export function limitPhotos(
  photos: RestaurantPhoto[] | undefined,
  limit: number
): RestaurantPhoto[] | undefined {
  if (!photos?.length) return undefined;
  return photos.slice(0, Math.max(0, limit));
}

export function reputationScore(rating?: number, reviewCount?: number): number {
  const stars = normalizeRating(rating);
  if (stars == null) return 0;
  const n = normalizeReviewCount(reviewCount) ?? 0;
  const prior = 3.7;
  const priorN = 40;
  return (stars * n + prior * priorN) / (n + priorN);
}

/** Soft Council bonus (0–8). High stars with few reviews stay modest. */
export function reputationBonus(rating?: number, reviewCount?: number): number {
  const blended = reputationScore(rating, reviewCount);
  if (blended <= 0) return 0;
  return Math.max(0, Math.min(8, (blended - 3.2) * 5));
}

export function formatRatingLabel(rating?: number, reviewCount?: number): string {
  const stars = normalizeRating(rating);
  if (stars == null) return "No rating available";
  const count = normalizeReviewCount(reviewCount);
  if (count == null) return `★ ${stars.toFixed(1)}`;
  return `★ ${stars.toFixed(1)} (${count.toLocaleString("en-US")})`;
}

export function ratingAriaLabel(rating?: number, reviewCount?: number): string {
  const stars = normalizeRating(rating);
  if (stars == null) return "No rating available";
  const count = normalizeReviewCount(reviewCount);
  if (count == null) return `Rated ${stars.toFixed(1)} out of 5`;
  return `Rated ${stars.toFixed(1)} out of 5 from ${count.toLocaleString("en-US")} ratings`;
}

export function photoAlt(restaurantName: string): string {
  return `Photo of ${restaurantName}`;
}

export interface PriceRangeAmounts {
  startAmount?: number;
  endAmount?: number;
  currencyCode?: string;
}

export function inferPriceLevelFromRange(range?: PriceRangeAmounts): number | undefined {
  if (!range) return undefined;
  const typical = range.endAmount ?? range.startAmount;
  if (typical == null || !Number.isFinite(typical) || typical < 0) return undefined;
  if (typical <= 15) return 1;
  if (typical <= 30) return 2;
  if (typical <= 60) return 3;
  return 4;
}

export function typicalPriceRangeFromLevel(priceLevel: number): PriceRangeAmounts | undefined {
  switch (priceLevel) {
    case 1:
      return { startAmount: 8, endAmount: 15, currencyCode: "USD" };
    case 2:
      return { startAmount: 15, endAmount: 30, currencyCode: "USD" };
    case 3:
      return { startAmount: 30, endAmount: 60, currencyCode: "USD" };
    case 4:
      return { startAmount: 60, currencyCode: "USD" };
    default:
      return undefined;
  }
}

export function formatMoneyAmount(amount: number, currencyCode = "USD"): string {
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
  priceRange?: PriceRangeAmounts;
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
          : level >= 4
            ? "typically $60+"
            : undefined;
  return { primary: symbols, detail };
}

export function attributionText(authors: Array<{ displayName?: string } | string> | undefined): string | undefined {
  const names = (authors ?? [])
    .map((item) => (typeof item === "string" ? item : item.displayName?.trim()))
    .filter((item): item is string => Boolean(item));
  if (names.length === 0) return undefined;
  return names.join(", ");
}

export function placeholderSvg(name: string): string {
  const label = escapeXml(name.trim() || "Restaurant");
  const hue = hashHue(label);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img" aria-label="${escapeXml(photoAlt(name))}">
  <rect width="640" height="400" fill="hsl(${hue} 28% 22%)"/>
  <text x="320" y="210" text-anchor="middle" fill="#f3ece1" font-family="Georgia, serif" font-size="28">${label}</text>
</svg>`;
}

function hashHue(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
