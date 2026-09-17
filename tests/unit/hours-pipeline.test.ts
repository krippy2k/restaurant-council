import { describe, expect, it } from "vitest";
import { createNegotiatorPrincipal } from "@rc/auth";
import { FixtureRestaurantSearch, MockRestaurantProvider, restaurantToCandidate } from "@rc/tools";
import { retainCandidatesByHours } from "@rc/orchestration";
import type { Event } from "@rc/domain";

function event(date?: string): Event {
  return {
    id: "evt_hours",
    ownerId: "usr_gee",
    name: "Saturday lunch",
    date,
    timezone: "America/New_York",
    restaurantSearchPolicy: { minimumOpenAfterEventMinutes: 60 },
    status: "negotiating",
    createdAt: "2026-09-16T12:00:00.000Z",
    updatedAt: "2026-09-16T12:00:00.000Z",
    searchArea: {
      displayName: "Midtown",
      latitude: 40.758,
      longitude: -73.9855,
      radiusMeters: 8000
    }
  };
}

describe("hours candidate pipeline", () => {
  it("eliminates closed and closes-too-soon restaurants and keeps unknown", async () => {
    const provider = new MockRestaurantProvider();
    const search = new FixtureRestaurantSearch();
    const origin = { latitude: 40.758, longitude: -73.9855 };
    const discovered = (await provider.search({ location: origin, radiusMeters: 8000 })).restaurants.map(
      (restaurant) => restaurantToCandidate(restaurant, origin)
    );
    const Saturday3pm = "2026-09-19T19:00:00.000Z";
    const result = await retainCandidatesByHours({
      candidates: discovered,
      event: event(Saturday3pm),
      restaurants: search,
      principal: createNegotiatorPrincipal("evt_hours")
    });
    expect(result.metrics.restaurant_hours_closed + result.metrics.restaurant_hours_closes_too_soon).toBeGreaterThan(
      0
    );
    expect(result.kept.some((item) => item.hoursAssessment?.status === "unknown")).toBe(true);
    expect(result.kept.every((item) => item.hoursAssessment?.status !== "closed")).toBe(true);
    expect(result.kept.every((item) => item.hoursAssessment?.status !== "closes-too-soon")).toBe(true);
    expect(result.eliminated.every((item) => item.assessment.status === "closed" || item.assessment.status === "closes-too-soon")).toBe(
      true
    );
  });

  it("keeps restaurants as unknown when the event has no datetime", async () => {
    const search = new FixtureRestaurantSearch();
    const discovered = await search.search(
      { eventId: "evt_hours", latitude: 40.758, longitude: -73.9855, radiusKm: 8 },
      createNegotiatorPrincipal("evt_hours")
    );
    const result = await retainCandidatesByHours({
      candidates: discovered,
      event: event(undefined),
      restaurants: search,
      principal: createNegotiatorPrincipal("evt_hours")
    });
    expect(result.eliminated).toEqual([]);
    expect(result.kept.every((item) => item.hoursAssessment?.status === "unknown")).toBe(true);
  });

  it("still performs hours lookups when search results already include hours so cache hits are counted", async () => {
    const search = new FixtureRestaurantSearch();
    const principal = createNegotiatorPrincipal("evt_hours");
    const discovered = await search.search(
      { eventId: "evt_hours", latitude: 40.758, longitude: -73.9855, radiusKm: 8 },
      principal
    );
    let hoursLookups = 0;
    const restaurants = {
      ...search,
      search: search.search.bind(search),
      getRestaurant: search.getRestaurant.bind(search),
      enrichHours: async (id: string, actor: typeof principal) => {
        hoursLookups += 1;
        return search.enrichHours(id, actor);
      }
    };
    const result = await retainCandidatesByHours({
      candidates: discovered,
      event: event("2026-09-19T19:00:00.000Z"),
      restaurants,
      principal
    });
    expect(hoursLookups).toBeGreaterThan(0);
    expect(result.metrics.restaurant_hours_cache_hit).toBeGreaterThan(0);
  });
});
