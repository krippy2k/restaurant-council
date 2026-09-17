import { AppError, ErrorCodes, nowIso } from "@rc/shared";
import type {
  Restaurant,
  RestaurantPhoto,
  RestaurantPhotoOptions,
  RestaurantPriceRange,
  RestaurantProvider,
  RestaurantReview,
  RestaurantSearchRequest,
  RestaurantSearchResult
} from "./domain.ts";
import { DETAIL_REVIEW_LIMIT, FINALIST_PHOTO_LIMIT } from "./domain.ts";
import { openingHoursFromGooglePlace } from "./hours/from-restaurant.ts";
import type { GoogleHoursPlace } from "./hours/google.ts";
import {
  attributionText,
  inferPriceLevelFromRange,
  limitPhotos,
  normalizeRating,
  normalizeReviewCount,
  photoOptions
} from "./enrichment.ts";
import { fetchWithTimeout, sanitizeProviderError } from "./http.ts";
import { restaurantCouncilId } from "./identity.ts";
import { estimatePlacesRequest, type PlacesBillableRequest } from "./places-billing.ts";

export const DISCOVERY_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.priceLevel,places.priceRange,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.photos";

export const DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,location,primaryType,types,priceLevel,priceRange,rating,userRatingCount,websiteUri,nationalPhoneNumber,internationalPhoneNumber,currentOpeningHours,regularOpeningHours,timeZone,outdoorSeating,reservable,servesVegetarianFood,photos,reviews";

export const HOURS_FIELD_MASK =
  "id,displayName,location,currentOpeningHours,regularOpeningHours,timeZone";

const CUISINE_TYPES: Record<string, string> = {
  steak: "steak_house",
  steakhouse: "steak_house",
  italian: "italian_restaurant",
  mexican: "mexican_restaurant",
  japanese: "japanese_restaurant",
  sushi: "sushi_restaurant",
  thai: "thai_restaurant",
  chinese: "chinese_restaurant",
  vietnamese: "vietnamese_restaurant",
  french: "french_restaurant",
  american: "american_restaurant",
  mediterranean: "mediterranean_restaurant",
  greek: "greek_restaurant",
  indian: "indian_restaurant",
  seafood: "seafood_restaurant",
  vegan: "vegan_restaurant",
  vegetarian: "vegetarian_restaurant",
  cafe: "cafe"
};

interface GoogleAuthor {
  displayName?: string;
}

interface GooglePhoto {
  name?: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: GoogleAuthor[];
}

interface GoogleReview {
  name?: string;
  rating?: number;
  text?: { text?: string };
  relativePublishTimeDescription?: string;
  publishTime?: string;
  authorAttribution?: GoogleAuthor;
}

interface GoogleMoney {
  currencyCode?: string;
  units?: string | number;
  nanos?: number;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  priceLevel?: string;
  priceRange?: { startPrice?: GoogleMoney; endPrice?: GoogleMoney };
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  regularOpeningHours?: GoogleHoursPlace["regularOpeningHours"];
  currentOpeningHours?: GoogleHoursPlace["currentOpeningHours"];
  timeZone?: { id?: string };
  outdoorSeating?: boolean;
  reservable?: boolean;
  servesVegetarianFood?: boolean;
  photos?: GooglePhoto[];
  reviews?: GoogleReview[];
}

function priceLevelFromGoogle(value: string | undefined): number | undefined {
  switch (value) {
    case "PRICE_LEVEL_INEXPENSIVE":
      return 1;
    case "PRICE_LEVEL_MODERATE":
      return 2;
    case "PRICE_LEVEL_EXPENSIVE":
      return 3;
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return 4;
    default:
      return undefined;
  }
}

export function googleMoneyAmount(money: GoogleMoney | undefined): number | undefined {
  if (!money) return undefined;
  const units = money.units == null ? 0 : Number(money.units);
  const nanos = money.nanos == null ? 0 : Number(money.nanos);
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return undefined;
  if (money.units == null && money.nanos == null) return undefined;
  const amount = units + nanos / 1_000_000_000;
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return Math.round(amount * 100) / 100;
}

export function priceRangeFromGoogle(
  range: { startPrice?: GoogleMoney; endPrice?: GoogleMoney } | undefined
): RestaurantPriceRange | undefined {
  if (!range) return undefined;
  const startAmount = googleMoneyAmount(range.startPrice);
  const endAmount = googleMoneyAmount(range.endPrice);
  if (startAmount == null && endAmount == null) return undefined;
  return {
    startAmount,
    endAmount,
    currencyCode: range.startPrice?.currencyCode || range.endPrice?.currencyCode || "USD"
  };
}

function cuisinesFromPlace(place: GooglePlace): string[] {
  const types = [...(place.types ?? []), place.primaryType ?? ""]
    .map((item) => item.replace(/_restaurant$/, "").replaceAll("_", " "))
    .filter((item) => item && !["point of interest", "establishment", "food", "restaurant"].includes(item));
  return [...new Set(types)];
}

export function photosFromGoogle(photos: GooglePhoto[] | undefined): RestaurantPhoto[] | undefined {
  const mapped: RestaurantPhoto[] = [];
  for (const photo of photos ?? []) {
    const providerPhotoId = photo.name?.trim();
    if (!providerPhotoId) continue;
    mapped.push({
      provider: "google",
      providerPhotoId,
      width: Number.isFinite(photo.widthPx) ? photo.widthPx : undefined,
      height: Number.isFinite(photo.heightPx) ? photo.heightPx : undefined,
      attribution: attributionText(photo.authorAttributions)
    });
  }
  return limitPhotos(mapped, FINALIST_PHOTO_LIMIT);
}

export function reviewsFromGoogle(reviews: GoogleReview[] | undefined): RestaurantReview[] | undefined {
  const mapped: RestaurantReview[] = [];
  for (const review of reviews ?? []) {
    const text = review.text?.text?.trim();
    const authorName = review.authorAttribution?.displayName?.trim();
    const rating = normalizeRating(review.rating);
    if (!text && rating == null && !authorName) continue;
    mapped.push({
      provider: "google",
      providerReviewId: review.name,
      rating,
      text: text || undefined,
      authorName: authorName || undefined,
      relativeTimeDescription: review.relativePublishTimeDescription?.trim() || undefined,
      publishedAt: review.publishTime,
      attribution: authorName || undefined
    });
    if (mapped.length >= DETAIL_REVIEW_LIMIT) break;
  }
  return mapped.length ? mapped : undefined;
}

function mapPlace(place: GooglePlace): Restaurant | null {
  if (!place.id || !place.location?.latitude || !place.location.longitude) return null;
  const name = place.displayName?.text?.trim();
  if (!name) return null;
  const priceRange = priceRangeFromGoogle(place.priceRange);
  return {
    id: restaurantCouncilId("google", place.id),
    provider: "google",
    providerId: place.id,
    name,
    address: place.formattedAddress,
    location: {
      latitude: place.location.latitude,
      longitude: place.location.longitude
    },
    cuisines: cuisinesFromPlace(place),
    primaryType: place.primaryType,
    priceLevel: priceLevelFromGoogle(place.priceLevel) ?? inferPriceLevelFromRange(priceRange),
    priceRange,
    rating: normalizeRating(place.rating),
    reviewCount: normalizeReviewCount(place.userRatingCount),
    photos: photosFromGoogle(place.photos),
    reviews: reviewsFromGoogle(place.reviews),
    providerAttribution: "Powered by Google",
    website: place.websiteUri,
    phone: place.nationalPhoneNumber?.trim() || place.internationalPhoneNumber?.trim(),
    attributes: {
      vegetarian: place.servesVegetarianFood,
      outdoorSeating: place.outdoorSeating,
      reservable: place.reservable
    },
    openingHours: openingHoursFromGooglePlace(place, nowIso()),
  };
}

export function assertSafePhotoUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(ErrorCodes.PROVIDER_UNAVAILABLE, "Photo URL was invalid.", 502);
  }
  parsed.searchParams.delete("key");
  parsed.searchParams.delete("apiKey");
  const href = parsed.toString();
  if (parsed.protocol !== "https:" || /AIza[0-9A-Za-z_-]+/.test(href)) {
    throw new AppError(ErrorCodes.PROVIDER_UNAVAILABLE, "Photo URL was rejected.", 502);
  }
  return href;
}

export function translateProviderError(status: number, body: string): AppError {
  if (status === 429) {
    return new AppError(
      ErrorCodes.PROVIDER_RATE_LIMITED,
      "Restaurant provider is rate limited. Try again shortly.",
      429
    );
  }
  if (status === 401 || status === 403) {
    return new AppError(
      ErrorCodes.PROVIDER_UNAVAILABLE,
      "Restaurant provider credentials were rejected.",
      502
    );
  }
  if (status >= 500) {
    return new AppError(
      ErrorCodes.PROVIDER_UNAVAILABLE,
      "Restaurant provider is unavailable.",
      502
    );
  }
  const snippet = body.replace(/AIza[0-9A-Za-z_-]+/g, "[redacted]").slice(0, 180);
  return new AppError(
    ErrorCodes.PROVIDER_UNAVAILABLE,
    snippet ? `Restaurant provider request failed: ${snippet}` : "Restaurant provider request failed.",
    502
  );
}

export class GooglePlacesRestaurantProvider implements RestaurantProvider {
  readonly name = "google" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly options: { onBillableRequest?: (request: PlacesBillableRequest) => void } = {}
  ) {}

  async search(request: RestaurantSearchRequest): Promise<RestaurantSearchResult> {
    const mappedTypes = (request.cuisines ?? [])
      .map((item) => CUISINE_TYPES[item.toLowerCase()])
      .filter(Boolean);
    const useText =
      Boolean(request.textQuery) ||
      ((request.cuisines?.length ?? 0) > 0 && mappedTypes.length !== request.cuisines?.length);

    const places = useText
      ? await this.searchText(request)
      : await this.searchNearby(request, mappedTypes);

    const restaurants = places
      .map(mapPlace)
      .filter((item): item is Restaurant => item != null);

    return {
      restaurants,
      search: { provider: "google", resultCount: restaurants.length }
    };
  }

  async getDetails(
    providerRestaurantId: string,
    options?: { hoursOnly?: boolean }
  ): Promise<Restaurant> {
    const payload = await this.requestJson(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(providerRestaurantId)}`,
      { method: "GET" },
      options?.hoursOnly ? HOURS_FIELD_MASK : DETAILS_FIELD_MASK
    );
    const restaurant = mapPlace(payload as GooglePlace);
    if (!restaurant) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Restaurant not found", 404);
    }
    return restaurant;
  }

  async getPhotoUrl(photo: RestaurantPhoto, options?: RestaurantPhotoOptions): Promise<string> {
    if (photo.provider !== "google" || !photo.providerPhotoId.startsWith("places/")) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Photo not found", 404);
    }
    const size = photoOptions(options);
    const params = new URLSearchParams({
      skipHttpRedirect: "true",
      maxWidthPx: String(size.maxWidth)
    });
    if (size.maxHeight != null) params.set("maxHeightPx", String(size.maxHeight));
    const payload = await this.requestJson(
      `https://places.googleapis.com/v1/${photo.providerPhotoId}/media?${params.toString()}`,
      { method: "GET" },
      ""
    );
    const photoUri = typeof payload.photoUri === "string" ? payload.photoUri : "";
    if (!photoUri) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Photo not found", 404);
    }
    return assertSafePhotoUrl(photoUri);
  }

  private async searchNearby(
    request: RestaurantSearchRequest,
    includedTypes: string[]
  ): Promise<GooglePlace[]> {
    const payload = await this.requestJson(
      "https://places.googleapis.com/v1/places:searchNearby",
      {
        method: "POST",
        body: JSON.stringify({
          includedTypes: includedTypes.length ? includedTypes : ["restaurant"],
          maxResultCount: Math.min(20, request.limit ?? 20),
          locationRestriction: {
            circle: {
              center: request.location,
              radius: request.radiusMeters
            }
          }
        })
      },
      DISCOVERY_FIELD_MASK
    );
    return Array.isArray(payload.places) ? (payload.places as GooglePlace[]) : [];
  }

  private async searchText(request: RestaurantSearchRequest): Promise<GooglePlace[]> {
    const cuisineClause = (request.cuisines ?? []).join(" ");
    const textQuery =
      request.textQuery?.trim() ||
      `${cuisineClause || "restaurants"} near ${request.location.latitude},${request.location.longitude}`;
    const payload = await this.requestJson(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        body: JSON.stringify({
          textQuery,
          includedType: "restaurant",
          maxResultCount: Math.min(20, request.limit ?? 20),
          locationBias: {
            circle: {
              center: request.location,
              radius: request.radiusMeters
            }
          }
        })
      },
      DISCOVERY_FIELD_MASK
    );
    return Array.isArray(payload.places) ? (payload.places as GooglePlace[]) : [];
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    fieldMask: string
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetchWithTimeout(this.fetchImpl, url, {
        ...init,
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          ...(fieldMask ? { "X-Goog-FieldMask": fieldMask } : {}),
          ...(init.headers ?? {})
        }
      });
    } catch (error) {
      console.error("google-places request failed", sanitizeProviderError(error));
      throw new AppError(
        ErrorCodes.PROVIDER_UNAVAILABLE,
        "Restaurant provider timed out or could not be reached.",
        502
      );
    }
    const body = await response.text();
    if (!response.ok) throw translateProviderError(response.status, body);
    try {
      const payload = JSON.parse(body) as Record<string, unknown>;
      this.options.onBillableRequest?.(estimatePlacesRequest(url, fieldMask));
      return payload;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        ErrorCodes.PROVIDER_UNAVAILABLE,
        "Restaurant provider returned an invalid response.",
        502
      );
    }
  }
}
