import { assertAuthorized, type Principal } from "@rc/auth";
import type { RestaurantCandidate } from "@rc/protocol";
import { MemoryRestaurantCache } from "./cache.ts";
import type { RestaurantSearchRequest } from "./domain.ts";
import { restaurantToCandidate } from "./map-candidate.ts";
import { MockRestaurantProvider } from "./restaurant-fixture.ts";
import { RestaurantSearchService } from "./service.ts";
import type {
  RestaurantDetails,
  RestaurantSearchQuery,
  RestaurantSearchTool
} from "./types.ts";

export class AuthorizedRestaurantSearch implements RestaurantSearchTool {
  constructor(private readonly service: RestaurantSearchService) {}

  async search(
    query: RestaurantSearchQuery,
    principal: Principal
  ): Promise<RestaurantCandidate[]> {
    return this.discover(
      {
        location: { latitude: query.latitude, longitude: query.longitude },
        radiusMeters: query.radiusKm != null ? query.radiusKm * 1000 : 8047,
        cuisines: query.cuisines,
        priceLevels: query.maxPriceLevel ? range(1, query.maxPriceLevel) : undefined,
        textQuery: query.query,
        limit: 40
      },
      principal
    );
  }

  async discover(
    request: RestaurantSearchRequest,
    principal: Principal
  ): Promise<RestaurantCandidate[]> {
    assertAuthorized({
      principal,
      action: "restaurant.search",
      resource: { type: "restaurant" }
    });
    const result = await this.service.searchUntil(request, 8);
    return result.restaurants.map((restaurant) =>
      restaurantToCandidate(restaurant, request.location)
    );
  }

  async getRestaurant(id: string, principal: Principal): Promise<RestaurantDetails> {
    assertAuthorized({
      principal,
      action: "restaurant.get",
      resource: { type: "restaurant" }
    });
    const restaurant = await this.service.getDetails(id);
    return restaurantToCandidate(restaurant, restaurant.location, { details: true });
  }

  async enrichHours(id: string, principal: Principal): Promise<RestaurantCandidate & { hoursCacheHit?: boolean }> {
    assertAuthorized({
      principal,
      action: "restaurant.get",
      resource: { type: "restaurant" }
    });
    const { restaurant, cacheHit } = await this.service.getHours(id);
    return { ...restaurantToCandidate(restaurant, restaurant.location), hoursCacheHit: cacheHit };
  }
}

export class FixtureRestaurantSearch extends AuthorizedRestaurantSearch {
  constructor() {
    super(new RestaurantSearchService(new MockRestaurantProvider(), new MemoryRestaurantCache()));
  }
}

function range(from: number, to: number): number[] {
  const values = [];
  for (let i = from; i <= to; i += 1) values.push(i);
  return values;
}
