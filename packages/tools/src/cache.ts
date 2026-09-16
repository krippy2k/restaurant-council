import type {
  Restaurant,
  RestaurantCache,
  RestaurantProviderType,
  RestaurantSearchResult
} from "./domain.ts";

interface MemoryEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryRestaurantCache implements RestaurantCache {
  private readonly searches = new Map<string, MemoryEntry<RestaurantSearchResult>>();
  private readonly byId = new Map<string, Restaurant>();
  private readonly byProvider = new Map<string, string>();
  hits = 0;
  misses = 0;

  async getSearch(key: string): Promise<RestaurantSearchResult | null> {
    const entry = this.searches.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (entry.expiresAt < Date.now()) {
      this.searches.delete(key);
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return entry.value;
  }

  async setSearch(
    key: string,
    result: RestaurantSearchResult,
    ttlMs: number
  ): Promise<void> {
    this.searches.set(key, { value: result, expiresAt: Date.now() + ttlMs });
  }

  async getRestaurant(id: string): Promise<Restaurant | null> {
    return this.byId.get(id) ?? null;
  }

  async getByProvider(
    provider: RestaurantProviderType,
    providerId: string
  ): Promise<Restaurant | null> {
    const id = this.byProvider.get(`${provider}:${providerId}`);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async putRestaurant(restaurant: Restaurant): Promise<void> {
    this.byId.set(restaurant.id, restaurant);
    this.byProvider.set(`${restaurant.provider}:${restaurant.providerId}`, restaurant.id);
  }
}
