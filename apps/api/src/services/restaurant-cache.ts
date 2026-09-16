import { nowIso } from "@rc/shared";
import type {
  Restaurant,
  RestaurantCache,
  RestaurantProviderType,
  RestaurantSearchResult
} from "@rc/tools";
import type { Database } from "../db/database.ts";

export class D1RestaurantCache implements RestaurantCache {
  constructor(private readonly db: Database) {}

  async getSearch(key: string): Promise<RestaurantSearchResult | null> {
    return this.db.getRestaurantSearchCache(key);
  }

  async setSearch(
    key: string,
    result: RestaurantSearchResult,
    ttlMs: number
  ): Promise<void> {
    await this.db.setRestaurantSearchCache(key, result, ttlMs);
  }

  async getRestaurant(id: string): Promise<Restaurant | null> {
    return this.db.getRestaurantReference(id);
  }

  async getByProvider(
    provider: RestaurantProviderType,
    providerId: string
  ): Promise<Restaurant | null> {
    return this.db.getRestaurantReferenceByProvider(provider, providerId);
  }

  async putRestaurant(restaurant: Restaurant): Promise<void> {
    await this.db.upsertRestaurantReference(restaurant, nowIso());
  }
}
