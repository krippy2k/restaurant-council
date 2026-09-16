import { createNegotiatorPrincipal } from "@rc/auth";
import { AppError, ErrorCodes } from "@rc/shared";
import { describe, expect, it } from "vitest";
import {
  MemoryRestaurantCache,
  MockLocationResolver,
  MockRestaurantProvider,
  RestaurantSearchService,
  applyDeterministicFilters,
  broadenSearchRequest,
  buildSearchRequest,
  restaurantCouncilId,
  validateSearchRequest
} from "@rc/tools";
import type { CouncilConstraint } from "@rc/protocol";

describe("restaurant identity", () => {
  it("does not use the provider id as the council id", () => {
    expect(restaurantCouncilId("google", "ChIJ123")).toMatch(/^res_/);
    expect(restaurantCouncilId("google", "ChIJ123")).not.toBe("ChIJ123");
    expect(restaurantCouncilId("google", "ChIJ123")).toBe(restaurantCouncilId("google", "ChIJ123"));
  });
});

describe("search request validation", () => {
  it("clamps radius and requires coordinates", () => {
    expect(() => validateSearchRequest({})).toThrow(/latitude/);
    const request = validateSearchRequest({
      latitude: 25.76,
      longitude: -80.19,
      radiusMeters: 999999
    });
    expect(request.radiusMeters).toBe(50_000);
  });
});

describe("constraint search mapping", () => {
  it("uses sanitized constraints and never copies source text", () => {
    const constraints: CouncilConstraint[] = [
      {
        id: "c1",
        eventId: "evt_a",
        participantId: "usr_gee",
        type: "CUISINE_PREFER",
        value: ["steak"],
        priority: "MEDIUM",
        visibility: "PUBLIC"
      },
      {
        id: "c2",
        eventId: "evt_a",
        participantId: "usr_sarah",
        type: "MAX_PRICE_LEVEL",
        value: 2,
        priority: "HARD",
        visibility: "PRIVATE_DERIVED"
      }
    ];
    const request = buildSearchRequest(
      {
        displayName: "Brickell, Miami, FL",
        latitude: 25.7617,
        longitude: -80.1918,
        radiusMeters: 8000
      },
      constraints
    );
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain("lost my job");
    expect(serialized).not.toContain("sourceText");
    expect(request.cuisines).toContain("steak");
    expect(request.required?.maxPriceLevel).toBe(2);
    expect(request.priceLevels).toEqual([1, 2]);
  });
});

describe("hard vs preferred filtering", () => {
  it("required price eliminates expensive restaurants and broadening cannot drop it", () => {
    const request = {
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000,
      priceLevels: [1, 2],
      required: { maxPriceLevel: 2 }
    };
    const restaurants = [
      {
        id: "res_cheap",
        provider: "mock" as const,
        providerId: "cheap",
        name: "Cheap",
        location: { latitude: 40.758, longitude: -73.9855 },
        cuisines: ["american"],
        priceLevel: 2
      },
      {
        id: "res_pricey",
        provider: "mock" as const,
        providerId: "pricey",
        name: "Pricey",
        location: { latitude: 40.758, longitude: -73.9855 },
        cuisines: ["steak"],
        priceLevel: 4
      }
    ];
    const filtered = applyDeterministicFilters(restaurants, request);
    expect(filtered.map((item) => item.name)).toEqual(["Cheap"]);
    const broadened = broadenSearchRequest(request);
    expect(broadened?.required?.maxPriceLevel).toBe(2);
  });
});

describe("mock provider contract", () => {
  it("searches and details using council ids", async () => {
    const provider = new MockRestaurantProvider();
    const result = await provider.search({
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000
    });
    expect(result.search.provider).toBe("mock");
    expect(result.restaurants.length).toBeGreaterThan(5);
    expect(result.restaurants.every((item) => item.id.startsWith("res_"))).toBe(true);
    expect(result.restaurants.every((item) => item.id !== item.providerId)).toBe(true);
    const stk = result.restaurants.find((item) => item.name === "STK");
    expect(stk?.priceLevel).toBe(4);
    expect(stk?.priceRange).toEqual({ startAmount: 60, currencyCode: "USD" });
    expect(stk?.photos?.length).toBe(1);
    expect(stk?.phone).toBe("(212) 555-0144");
    expect(stk?.website).toBe("https://stk.example.com");
    const grazianos = result.restaurants.find((item) => item.name === "Graziano's");
    expect(grazianos?.email).toBe("hello@grazianos.example");
    const details = await provider.getDetails(stk?.providerId ?? "");
    expect(details.name).toBe("STK");
    expect(details.reviews?.length).toBeGreaterThan(0);
  });
});

describe("search service cache", () => {
  it("returns a cache hit on the second identical search", async () => {
    const cache = new MemoryRestaurantCache();
    const service = new RestaurantSearchService(new MockRestaurantProvider(), cache);
    const request = {
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000
    };
    const first = await service.search(request);
    const second = await service.search(request);
    expect(first.search.cacheHit).toBeFalsy();
    expect(second.search.cacheHit).toBe(true);
    expect(cache.hits).toBeGreaterThan(0);
  });
});

describe("location resolver", () => {
  it("resolves known neighborhoods and coordinates", async () => {
    const resolver = new MockLocationResolver();
    const miami = await resolver.resolve("Brickell, Miami");
    expect(miami.latitude).toBeCloseTo(25.7617, 3);
    const coords = await resolver.resolve("40.758, -73.9855");
    expect(coords.source).toBe("coordinates");
    await expect(resolver.resolve("atlantis")).rejects.toMatchObject({
      code: ErrorCodes.LOCATION_NOT_FOUND
    } satisfies Partial<AppError>);
  });
});

describe("authorized search still requires restaurant capability", () => {
  it("is covered by FixtureRestaurantSearch", async () => {
    const principal = createNegotiatorPrincipal("evt_a");
    principal.capabilities = [];
    const { FixtureRestaurantSearch } = await import("@rc/tools");
    const search = new FixtureRestaurantSearch();
    await expect(
      search.search({ eventId: "evt_a", latitude: 40.7, longitude: -74 }, principal)
    ).rejects.toMatchObject({ code: ErrorCodes.AGENT_CAPABILITY_DENIED });
  });
});
