import { describe, expect, it } from "vitest";
import {
  evaluateRestaurantHours,
  googlePlaceToRestaurantHours,
  hoursAreFresh,
  materializeWeeklyPeriods,
  parseFixtureHours
} from "@rc/tools";
import type { RestaurantHours } from "@rc/protocol";

const TZ = "America/New_York";

function hours(periods: RestaurantHours["periods"]): RestaurantHours {
  return {
    periods,
    source: { provider: "test", retrievedAt: "2026-09-16T12:00:00.000Z", type: "regular" }
  };
}

describe("restaurant hours evaluator", () => {
  it("treats a 3pm event with a 10pm close as suitable", () => {
    const assessment = evaluateRestaurantHours(
      hours([{ opensAt: "2026-09-19T15:00:00.000Z", closesAt: "2026-09-19T22:00:00.000Z" }]),
      "2026-09-19T15:00:00.000Z",
      { restaurantId: "res_a" }
    );
    expect(assessment.status).toBe("suitable");
  });

  it("accepts closing exactly 60 minutes after the event start", () => {
    const assessment = evaluateRestaurantHours(
      hours([{ opensAt: "2026-09-19T15:00:00.000Z", closesAt: "2026-09-19T16:00:00.000Z" }]),
      "2026-09-19T15:00:00.000Z",
      { restaurantId: "res_a" }
    );
    expect(assessment.status).toBe("suitable");
  });

  it("marks a 3:59pm close as closes-too-soon for a 3pm event", () => {
    const assessment = evaluateRestaurantHours(
      hours([{ opensAt: "2026-09-19T15:00:00.000Z", closesAt: "2026-09-19T15:59:00.000Z" }]),
      "2026-09-19T15:00:00.000Z",
      { restaurantId: "res_a" }
    );
    expect(assessment.status).toBe("closes-too-soon");
  });

  it("marks a restaurant that closed at 2pm as closed for a 3pm event", () => {
    const assessment = evaluateRestaurantHours(
      hours([{ opensAt: "2026-09-19T11:00:00.000Z", closesAt: "2026-09-19T14:00:00.000Z" }]),
      "2026-09-19T15:00:00.000Z",
      { restaurantId: "res_a" }
    );
    expect(assessment.status).toBe("closed");
  });

  it("marks a restaurant that opens at 5pm as closed for a 3pm event", () => {
    const assessment = evaluateRestaurantHours(
      hours([{ opensAt: "2026-09-19T17:00:00.000Z", closesAt: "2026-09-19T22:00:00.000Z" }]),
      "2026-09-19T15:00:00.000Z",
      { restaurantId: "res_a" }
    );
    expect(assessment.status).toBe("closed");
  });

  it("does not combine split lunch and dinner periods", () => {
    const split = hours([
      { opensAt: "2026-09-19T15:00:00.000Z", closesAt: "2026-09-19T18:30:00.000Z" },
      { opensAt: "2026-09-19T21:00:00.000Z", closesAt: "2026-09-20T02:00:00.000Z" }
    ]);
    expect(
      evaluateRestaurantHours(split, "2026-09-19T18:00:00.000Z", { restaurantId: "res_a" }).status
    ).toBe("closes-too-soon");
    expect(
      evaluateRestaurantHours(split, "2026-09-19T19:00:00.000Z", { restaurantId: "res_a" }).status
    ).toBe("closed");
  });

  it("handles overnight Friday hours across midnight", () => {
    const overnight = hours([
      { opensAt: "2026-09-19T21:00:00.000Z", closesAt: "2026-09-20T06:00:00.000Z" }
    ]);
    expect(
      evaluateRestaurantHours(overnight, "2026-09-20T03:30:00.000Z", { restaurantId: "res_a" }).status
    ).toBe("suitable");
  });

  it("marks an overnight close of 12:15am as too soon for an 11:30pm event", () => {
    const overnight = hours([
      { opensAt: "2026-09-19T21:00:00.000Z", closesAt: "2026-09-20T04:15:00.000Z" }
    ]);
    expect(
      evaluateRestaurantHours(overnight, "2026-09-20T03:30:00.000Z", { restaurantId: "res_a" }).status
    ).toBe("closes-too-soon");
  });

  it("treats 24-hour restaurants as suitable", () => {
    const assessment = evaluateRestaurantHours(
      hours([{ opensAt: "2026-09-19T00:00:00.000Z" }]),
      "2026-09-19T15:00:00.000Z",
      { restaurantId: "res_a" }
    );
    expect(assessment.status).toBe("suitable");
  });

  it("returns unknown when hours are missing", () => {
    expect(
      evaluateRestaurantHours(undefined, "2026-09-19T15:00:00.000Z", { restaurantId: "res_a" }).status
    ).toBe("unknown");
    expect(
      evaluateRestaurantHours(hours([]), "2026-09-19T15:00:00.000Z", { restaurantId: "res_a" }).status
    ).toBe("unknown");
  });

  it("honors a 120-minute minimum", () => {
    const assessment = evaluateRestaurantHours(
      hours([{ opensAt: "2026-09-19T19:00:00.000Z", closesAt: "2026-09-19T20:30:00.000Z" }]),
      "2026-09-19T19:00:00.000Z",
      { restaurantId: "res_a", minimumOpenAfterEventMinutes: 120 }
    );
    expect(assessment.status).toBe("closes-too-soon");
  });

  it("returns unknown for an invalid event datetime instead of closed", () => {
    const assessment = evaluateRestaurantHours(
      hours([{ opensAt: "2026-09-19T15:00:00.000Z", closesAt: "2026-09-19T22:00:00.000Z" }]),
      "not-a-date",
      { restaurantId: "res_a" }
    );
    expect(assessment.status).toBe("unknown");
  });
});

describe("timezone-aware weekly hours", () => {
  it("evaluates overnight New York hours without comparing clock strings", () => {
    const periods = materializeWeeklyPeriods(
      [{ open: { day: 5, hour: 17, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }],
      "2026-09-19T03:30:00.000Z",
      TZ
    );
    expect(
      evaluateRestaurantHours(hours(periods ?? []), "2026-09-19T03:30:00.000Z", { restaurantId: "res_a" }).status
    ).toBe("suitable");
  });

  it("parses mock fixture split hours", () => {
    const weekly = parseFixtureHours("11:00 AM – 2:30 PM, 5:00 PM – 10:00 PM");
    expect(weekly?.length).toBeGreaterThan(7);
  });
});

describe("Google hours normalization", () => {
  const event = "2026-09-19T19:00:00.000Z";

  it("prefers current hours over regular hours", () => {
    const hours = googlePlaceToRestaurantHours(
      {
        timeZone: { id: TZ },
        currentOpeningHours: {
          periods: [{ open: { day: 6, hour: 11, minute: 0 }, close: { day: 6, hour: 22, minute: 0 } }]
        },
        regularOpeningHours: {
          periods: [{ open: { day: 6, hour: 11, minute: 0 }, close: { day: 6, hour: 15, minute: 0 } }]
        }
      },
      event,
      "2026-09-16T12:00:00.000Z",
      new Date("2026-09-16T12:00:00.000Z")
    );
    expect(hours?.source.type).toBe("current");
    const assessment = evaluateRestaurantHours(hours, event, { restaurantId: "res_a" });
    expect(assessment.status).toBe("suitable");
  });

  it("falls back to regular hours when current hours are missing", () => {
    const hours = googlePlaceToRestaurantHours(
      {
        timeZone: { id: TZ },
        regularOpeningHours: {
          periods: [{ open: { day: 6, hour: 11, minute: 0 }, close: { day: 6, hour: 22, minute: 0 } }]
        }
      },
      event,
      "2026-09-16T12:00:00.000Z",
      new Date("2026-09-16T12:00:00.000Z")
    );
    expect(hours?.source.type).toBe("regular");
    expect(evaluateRestaurantHours(hours, event, { restaurantId: "res_a" }).status).toBe("suitable");
  });

  it("does not treat a provider failure or missing periods as closed", () => {
    expect(
      googlePlaceToRestaurantHours({ timeZone: { id: TZ } }, event, "2026-09-16T12:00:00.000Z")
    ).toBeUndefined();
  });
});

describe("restaurant hours cache", () => {
  const restaurant = {
    id: "res_a",
    provider: "mock" as const,
    providerId: "res_a",
    name: "Cafe",
    location: { latitude: 40.76, longitude: -73.98 },
    cuisines: ["cafe"],
    openingHours: {
      retrievedAt: "2026-09-10T12:00:00.000Z",
      sourceType: "current" as const,
      timeZone: TZ,
      weeklyPeriods: [{ open: { day: 3, hour: 11, minute: 0 }, close: { day: 3, hour: 22, minute: 0 } }]
    }
  };

  it("keeps provider hours for a week", () => {
    expect(hoursAreFresh(restaurant, Date.parse("2026-09-17T11:59:00.000Z"))).toBe(true);
  });

  it("refetches provider hours after a week", () => {
    expect(hoursAreFresh(restaurant, Date.parse("2026-09-17T12:00:01.000Z"))).toBe(false);
  });
});
