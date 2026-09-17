import { AppError, ErrorCodes, nowIso } from "@rc/shared";
import type {
  Restaurant,
  RestaurantCache,
  RestaurantPhotoOptions,
  RestaurantProvider,
  RestaurantSearchResult
} from "./domain.ts";
import {
  DISCOVERY_LIMIT,
  FINALIST_PHOTO_LIMIT,
  MAX_SEARCH_LIMIT,
  PHOTO_CACHE_SECONDS,
  SEARCH_CACHE_TTL_MS
} from "./domain.ts";
import { applyDeterministicFilters, broadenSearchRequest, rankBySoftConstraints } from "./filters.ts";
import { searchCacheKey } from "./identity.ts";
import { mergePhotos, placeholderSvg } from "./enrichment.ts";
import { hasStructuredHours, hoursAreFresh, HOURS_CACHE_TTL_MS } from "./hours/from-restaurant.ts";
import { validateSearchRequest } from "./search-request.ts";
import type { PlacesCacheKind } from "./places-billing.ts";

export interface RestaurantSearchMetrics {
  restaurant_search_count: number;
  restaurant_details_requests: number;
  restaurant_details_enrichment_requests: number;
  restaurant_cache_hits: number;
  restaurant_cache_misses: number;
  restaurant_photo_requests: number;
  restaurant_photo_failures: number;
  restaurant_photo_cache_hits: number;
  restaurant_review_requests: number;
  restaurant_rating_available: number;
  restaurant_rating_missing: number;
  provider_errors: number;
  last_result_count: number;
}

export type ResolvedRestaurantPhoto =
  | { kind: "redirect"; url: string; cacheSeconds: number }
  | { kind: "bytes"; body: string; contentType: string; cacheSeconds: number };

export class RestaurantSearchService {
  readonly metrics: RestaurantSearchMetrics = {
    restaurant_search_count: 0,
    restaurant_details_requests: 0,
    restaurant_details_enrichment_requests: 0,
    restaurant_cache_hits: 0,
    restaurant_cache_misses: 0,
    restaurant_photo_requests: 0,
    restaurant_photo_failures: 0,
    restaurant_photo_cache_hits: 0,
    restaurant_review_requests: 0,
    restaurant_rating_available: 0,
    restaurant_rating_missing: 0,
    provider_errors: 0,
    last_result_count: 0
  };

  constructor(
    private readonly provider: RestaurantProvider,
    private readonly cache: RestaurantCache,
    private readonly options: { onPlacesCacheHit?: (kind: PlacesCacheKind) => void } = {}
  ) {}

  get providerName() {
    return this.provider.name;
  }

  async search(input: unknown): Promise<RestaurantSearchResult> {
    const request = validateSearchRequest(input);
    request.limit = Math.min(MAX_SEARCH_LIMIT, request.limit ?? DISCOVERY_LIMIT);
    this.metrics.restaurant_search_count += 1;

    const key = searchCacheKey(this.provider.name, request);
    const cached = await this.cache.getSearch(key);
    if (cached) {
      this.metrics.restaurant_cache_hits += 1;
      this.metrics.last_result_count = cached.restaurants.length;
      this.options.onPlacesCacheHit?.("search");
      return { ...cached, search: { ...cached.search, cacheHit: true } };
    }
    this.metrics.restaurant_cache_misses += 1;

    let providerResult: RestaurantSearchResult;
    try {
      providerResult = await this.provider.search(request);
    } catch (error) {
      this.metrics.provider_errors += 1;
      throw error;
    }

    const filtered = rankBySoftConstraints(
      applyDeterministicFilters(dedupeRestaurants(providerResult.restaurants), request),
      request
    ).slice(0, request.limit);

    const hydrated = [];
    for (const restaurant of filtered) {
      const existing =
        (await this.cache.getRestaurant(restaurant.id)) ??
        (await this.cache.getByProvider(restaurant.provider, restaurant.providerId));
      const merged = existing
        ? {
            ...existing,
            ...restaurant,
            id: existing.id,
            provider: existing.provider,
            providerId: existing.providerId,
            photos: mergePhotos(restaurant.photos, existing.photos),
            reviews: restaurant.reviews?.length ? restaurant.reviews : existing.reviews,
            openingHours: hasStructuredHours(existing) ? existing.openingHours : restaurant.openingHours,
            detailsCoverage: existing.detailsCoverage,
            detailsRetrievedAt: existing.detailsRetrievedAt
          }
        : restaurant;
      await this.cache.putRestaurant(merged);
      hydrated.push(merged);
      if (merged.rating != null) this.metrics.restaurant_rating_available += 1;
      else this.metrics.restaurant_rating_missing += 1;
    }

    const result: RestaurantSearchResult = {
      restaurants: hydrated,
      search: {
        provider: this.provider.name,
        resultCount: filtered.length,
        cacheHit: false,
        relaxation: request.relaxation
      }
    };
    await this.cache.setSearch(key, result, SEARCH_CACHE_TTL_MS);
    this.metrics.last_result_count = filtered.length;
    return result;
  }

  async searchUntil(
    input: unknown,
    minResults = 8
  ): Promise<RestaurantSearchResult> {
    let request = validateSearchRequest(input);
    let result = await this.search(request);
    while (result.restaurants.length < minResults) {
      const next = broadenSearchRequest({ ...request, relaxation: result.search.relaxation });
      if (!next) break;
      request = next;
      result = await this.search(request);
    }
    return result;
  }

  async getHours(restaurantId: string): Promise<{ restaurant: Restaurant; cacheHit: boolean }> {
    const cached = await this.cache.getRestaurant(restaurantId);
    if (!cached) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Restaurant not found", 404);
    }
    if (hasStructuredHours(cached) && hoursAreFresh(cached)) {
      this.metrics.restaurant_cache_hits += 1;
      this.options.onPlacesCacheHit?.("hours");
      return { restaurant: cached, cacheHit: true };
    }
    if (cachedDetailsCover(cached, "hours")) {
      this.metrics.restaurant_cache_hits += 1;
      this.options.onPlacesCacheHit?.("hours");
      return { restaurant: cached, cacheHit: true };
    }
    return { restaurant: await this.getDetails(restaurantId, { hoursOnly: true }), cacheHit: false };
  }

  async getDetails(restaurantId: string, options?: { hoursOnly?: boolean }): Promise<Restaurant> {
    this.metrics.restaurant_details_requests += 1;
    this.metrics.restaurant_details_enrichment_requests += 1;
    const cached = await this.cache.getRestaurant(restaurantId);
    if (!cached) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Restaurant not found", 404);
    }
    const requested = requestedCoverage(options?.hoursOnly);
    if (cachedDetailsCover(cached, requested)) {
      this.metrics.restaurant_cache_hits += 1;
      this.options.onPlacesCacheHit?.(requested);
      return cached;
    }
    if (options?.hoursOnly && hoursAreFresh(cached) && hasStructuredHours(cached)) {
      this.metrics.restaurant_cache_hits += 1;
      this.options.onPlacesCacheHit?.("hours");
      return cached;
    }
    try {
      const fresh = await this.provider.getDetails(cached.providerId, options);
      if (!options?.hoursOnly) this.metrics.restaurant_review_requests += 1;
      const merged: Restaurant = options?.hoursOnly
        ? {
            ...cached,
            openingHours: fresh.openingHours ?? cached.openingHours,
            detailsCoverage: inferredCoverage(cached) === "details" ? "details" : "hours",
            detailsRetrievedAt:
              inferredCoverage(cached) === "details" ? detailsRetrievedAt(cached) : nowIso()
          }
        : {
            ...cached,
            ...fresh,
            id: cached.id,
            provider: cached.provider,
            providerId: cached.providerId,
            location: cached.location,
            photos: mergePhotos(fresh.photos, cached.photos, FINALIST_PHOTO_LIMIT),
            reviews: fresh.reviews?.length ? fresh.reviews : cached.reviews,
            openingHours: fresh.openingHours ?? cached.openingHours,
            detailsCoverage: "details",
            detailsRetrievedAt: nowIso()
          };
      await this.cache.putRestaurant(merged);
      return merged;
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCodes.NOT_FOUND) {
        return cached;
      }
      this.metrics.provider_errors += 1;
      return cached;
    }
  }

  async resolvePhoto(
    restaurantId: string,
    photoId: string,
    options?: RestaurantPhotoOptions
  ): Promise<ResolvedRestaurantPhoto> {
    this.metrics.restaurant_photo_requests += 1;
    const restaurant = await this.cache.getRestaurant(restaurantId);
    if (!restaurant) {
      this.metrics.restaurant_photo_failures += 1;
      throw new AppError(ErrorCodes.NOT_FOUND, "Restaurant not found", 404);
    }
    const photo = restaurant.photos?.find((item) => item.providerPhotoId === photoId) ?? {
      provider: restaurant.provider,
      providerPhotoId: photoId
    };
    if (this.provider.name === "mock" || !this.provider.getPhotoUrl) {
      return {
        kind: "bytes",
        body: placeholderSvg(restaurant.name),
        contentType: "image/svg+xml; charset=utf-8",
        cacheSeconds: PHOTO_CACHE_SECONDS
      };
    }
    try {
      const url = await this.provider.getPhotoUrl(photo, options);
      return { kind: "redirect", url, cacheSeconds: PHOTO_CACHE_SECONDS };
    } catch (error) {
      this.metrics.restaurant_photo_failures += 1;
      if (error instanceof AppError) throw error;
      throw new AppError(
        ErrorCodes.PROVIDER_UNAVAILABLE,
        "Restaurant photo could not be loaded.",
        502
      );
    }
  }
}

function requestedCoverage(hoursOnly?: boolean): "hours" | "details" {
  return hoursOnly ? "hours" : "details";
}

function inferredCoverage(restaurant: Restaurant): "hours" | "details" | undefined {
  if (restaurant.detailsCoverage) return restaurant.detailsCoverage;
  if (restaurant.reviews?.length) return "details";
  return undefined;
}

function detailsRetrievedAt(restaurant: Restaurant): string | undefined {
  return restaurant.detailsRetrievedAt ?? restaurant.openingHours?.retrievedAt;
}

function cachedDetailsCover(restaurant: Restaurant, requested: "hours" | "details"): boolean {
  const coverage = inferredCoverage(restaurant);
  if (!coverage) return false;
  if (requested === "details" && coverage !== "details") return false;
  const retrievedAt = detailsRetrievedAt(restaurant);
  if (!retrievedAt) return false;
  const retrieved = Date.parse(retrievedAt);
  if (!Number.isFinite(retrieved)) return false;
  return Date.now() - retrieved < HOURS_CACHE_TTL_MS;
}

function dedupeRestaurants(restaurants: Restaurant[]): Restaurant[] {
  const seen = new Set<string>();
  const unique: Restaurant[] = [];
  for (const restaurant of restaurants) {
    const key = `${restaurant.provider}:${restaurant.providerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(restaurant);
  }
  return unique;
}
