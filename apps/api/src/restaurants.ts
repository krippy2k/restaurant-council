import {
  AuthorizedRestaurantSearch,
  CachingDietaryAnalyzer,
  EvidenceDietaryAnalyzer,
  GoogleLocationResolver,
  GooglePlacesRestaurantProvider,
  MemoryDietaryCache,
  MemoryRestaurantCache,
  MockDietaryAnalyzer,
  MockLocationResolver,
  MockRestaurantProvider,
  RestaurantSearchService,
  type DietaryAnalyzer,
  type LocationResolver,
  type PlacesBillableRequest,
  type PlacesCacheKind,
  type RestaurantSearchTool
} from "@rc/tools";
import type { Database } from "./db/database.ts";
import type { Env } from "./env.ts";
import { D1DietaryCache } from "./services/dietary-cache.ts";
import { D1RestaurantCache } from "./services/restaurant-cache.ts";

export function restaurantProviderName(env: Env): "google" | "mock" {
  if (env.RESTAURANT_PROVIDER === "mock") return "mock";
  if (env.RESTAURANT_PROVIDER === "google" && !env.GOOGLE_PLACES_API_KEY) return "mock";
  return env.GOOGLE_PLACES_API_KEY ? "google" : "mock";
}

export function createRestaurantSearch(
  env: Env,
  db?: Database,
  options?: {
    onPlacesRequest?: (request: PlacesBillableRequest) => void;
    onPlacesCacheHit?: (kind: PlacesCacheKind) => void;
  }
): RestaurantSearchTool {
  const cache = db ? new D1RestaurantCache(db) : new MemoryRestaurantCache();
  const provider =
    restaurantProviderName(env) === "google" && env.GOOGLE_PLACES_API_KEY
      ? new GooglePlacesRestaurantProvider(env.GOOGLE_PLACES_API_KEY, fetch, {
          onBillableRequest: options?.onPlacesRequest
        })
      : new MockRestaurantProvider();
  return new AuthorizedRestaurantSearch(
    new RestaurantSearchService(provider, cache, { onPlacesCacheHit: options?.onPlacesCacheHit })
  );
}

export function createLocationResolver(env: Env): LocationResolver {
  if (restaurantProviderName(env) === "google" && env.GOOGLE_PLACES_API_KEY) {
    return new GoogleLocationResolver(env.GOOGLE_PLACES_API_KEY);
  }
  return new MockLocationResolver();
}

export function dietaryAnalyzerName(env: Env): "mock" | "live" {
  if (env.DIETARY_ANALYZER === "mock") return "mock";
  if (env.DIETARY_ANALYZER === "live") return "live";
  return restaurantProviderName(env) === "google" ? "live" : "mock";
}

export function createDietaryAnalyzer(env: Env, db?: Database): DietaryAnalyzer {
  const inner =
    dietaryAnalyzerName(env) === "live"
      ? new EvidenceDietaryAnalyzer()
      : new MockDietaryAnalyzer();
  const cache = db ? new D1DietaryCache(db) : new MemoryDietaryCache();
  return new CachingDietaryAnalyzer(inner, cache);
}

export function createRestaurantService(env: Env, db: Database): RestaurantSearchService {
  const provider =
    restaurantProviderName(env) === "google" && env.GOOGLE_PLACES_API_KEY
      ? new GooglePlacesRestaurantProvider(env.GOOGLE_PLACES_API_KEY)
      : new MockRestaurantProvider();
  return new RestaurantSearchService(provider, new D1RestaurantCache(db));
}
