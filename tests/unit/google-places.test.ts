import { describe, expect, it } from "vitest";
import {
  DETAILS_FIELD_MASK,
  DISCOVERY_FIELD_MASK,
  HOURS_FIELD_MASK,
  GooglePlacesRestaurantProvider
} from "@rc/tools";
import { ErrorCodes } from "@rc/shared";

describe("Google Places provider", () => {
  it("sends an explicit discovery field mask and normalizes places", async () => {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("places:searchNearby");
      expect(new Headers(init?.headers).get("X-Goog-FieldMask")).toBe(DISCOVERY_FIELD_MASK);
      expect(new Headers(init?.headers).get("X-Goog-Api-Key")).toBe("test-key");
      return new Response(
        JSON.stringify({
          places: [
            {
              id: "ChIJ-test",
              displayName: { text: "Real Steak" },
              formattedAddress: "1 Ocean Dr",
              location: { latitude: 25.76, longitude: -80.19 },
              primaryType: "steak_house",
              types: ["steak_house", "restaurant"],
              priceLevel: "PRICE_LEVEL_EXPENSIVE",
              priceRange: {
                startPrice: { currencyCode: "USD", units: "45" },
                endPrice: { currencyCode: "USD", units: "80" }
              },
              rating: 4.6,
              userRatingCount: 212,
              nationalPhoneNumber: "(305) 555-0199",
              websiteUri: "https://realsteak.example.com",
              photos: [
                {
                  name: "places/ChIJ-test/photos/abc",
                  widthPx: 1600,
                  heightPx: 900,
                  authorAttributions: [{ displayName: "Guest" }]
                }
              ]
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const provider = new GooglePlacesRestaurantProvider("test-key", fetchImpl);
    const result = await provider.search({
      location: { latitude: 25.76, longitude: -80.19 },
      radiusMeters: 4000
    });
    expect(result.restaurants[0]?.name).toBe("Real Steak");
    expect(result.restaurants[0]?.provider).toBe("google");
    expect(result.restaurants[0]?.providerId).toBe("ChIJ-test");
    expect(result.restaurants[0]?.id).not.toBe("ChIJ-test");
    expect(result.restaurants[0]?.priceLevel).toBe(3);
    expect(result.restaurants[0]?.priceRange).toEqual({
      startAmount: 45,
      endAmount: 80,
      currencyCode: "USD"
    });
    expect(result.restaurants[0]?.rating).toBe(4.6);
    expect(result.restaurants[0]?.reviewCount).toBe(212);
    expect(result.restaurants[0]?.photos?.[0]?.providerPhotoId).toBe("places/ChIJ-test/photos/abc");
    expect(result.restaurants[0]?.photos?.[0]?.attribution).toBe("Guest");
    expect(result.restaurants[0]?.providerAttribution).toBe("Powered by Google");
    expect(result.restaurants[0]?.phone).toBe("(305) 555-0199");
    expect(result.restaurants[0]?.website).toBe("https://realsteak.example.com");
  });

  it("uses the details field mask for finalists", async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("X-Goog-FieldMask")).toBe(DETAILS_FIELD_MASK);
      return new Response(
        JSON.stringify({
          id: "ChIJ-test",
          displayName: { text: "Real Steak" },
          location: { latitude: 25.76, longitude: -80.19 },
          websiteUri: "https://example.com",
          nationalPhoneNumber: "(305) 555-0100",
          internationalPhoneNumber: "+1 305-555-0100",
          reviews: [
            {
              name: "places/ChIJ-test/reviews/1",
              rating: 5,
              text: { text: "Excellent food and service." },
              authorAttribution: { displayName: "Alex R." }
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const provider = new GooglePlacesRestaurantProvider("test-key", fetchImpl);
    const details = await provider.getDetails("ChIJ-test");
    expect(details.website).toBe("https://example.com");
    expect(details.phone).toBe("(305) 555-0100");
    expect(details.reviews?.[0]?.text).toBe("Excellent food and service.");
    expect(details.reviews?.[0]?.authorName).toBe("Alex R.");
  });

  it("reports a billable Nearby Search Enterprise request", async () => {
    const billed: Array<{ sku: string; estimatedUsd: number }> = [];
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ places: [] }), { status: 200 })) as typeof fetch;
    const provider = new GooglePlacesRestaurantProvider("test-key", fetchImpl, {
      onBillableRequest: (request) => billed.push(request)
    });
    await provider.search({
      location: { latitude: 25.76, longitude: -80.19 },
      radiusMeters: 4000
    });
    expect(billed).toEqual([
      expect.objectContaining({
        operation: "nearby-search",
        sku: "Nearby Search Enterprise",
        estimatedUsd: 0.035
      })
    ]);
  });

  it("uses a hours-only field mask when fetching opening hours", async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("X-Goog-FieldMask")).toBe(HOURS_FIELD_MASK);
      return new Response(
        JSON.stringify({
          id: "ChIJ-test",
          displayName: { text: "Real Steak" },
          location: { latitude: 25.76, longitude: -80.19 },
          timeZone: { id: "America/New_York" },
          regularOpeningHours: {
            weekdayDescriptions: ["Monday: 11:00 AM – 10:00 PM"],
            periods: [{ open: { day: 1, hour: 11, minute: 0 }, close: { day: 1, hour: 22, minute: 0 } }]
          }
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const provider = new GooglePlacesRestaurantProvider("test-key", fetchImpl);
    const details = await provider.getDetails("ChIJ-test", { hoursOnly: true });
    expect(details.openingHours?.timeZone).toBe("America/New_York");
    expect(details.openingHours?.weekdayText?.[0]).toContain("Monday");
  });

  it("infers a price level from Google's dollar range when priceLevel is missing", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          places: [
            {
              id: "ChIJ-range",
              displayName: { text: "Taco Spot" },
              formattedAddress: "2 Ocean Dr",
              location: { latitude: 25.76, longitude: -80.19 },
              primaryType: "mexican_restaurant",
              priceRange: {
                startPrice: { currencyCode: "USD", units: "12" },
                endPrice: { currencyCode: "USD", units: "22" }
              }
            }
          ]
        }),
        { status: 200 }
      )) as typeof fetch;
    const provider = new GooglePlacesRestaurantProvider("test-key", fetchImpl);
    const result = await provider.search({
      location: { latitude: 25.76, longitude: -80.19 },
      radiusMeters: 4000
    });
    expect(result.restaurants[0]?.priceRange).toEqual({
      startAmount: 12,
      endAmount: 22,
      currencyCode: "USD"
    });
    expect(result.restaurants[0]?.priceLevel).toBe(2);
  });

  it("falls back to the international phone number when a national number is missing", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          id: "ChIJ-intl",
          displayName: { text: "Cafe" },
          location: { latitude: 25.76, longitude: -80.19 },
          internationalPhoneNumber: "+44 20 7946 0958"
        }),
        { status: 200 }
      )) as typeof fetch;
    const provider = new GooglePlacesRestaurantProvider("test-key", fetchImpl);
    const details = await provider.getDetails("ChIJ-intl");
    expect(details.phone).toBe("+44 20 7946 0958");
  });

  it("resolves a photo media URI without exposing the API key", async () => {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/media");
      expect(String(input)).toContain("maxWidthPx=800");
      expect(new Headers(init?.headers).get("X-Goog-Api-Key")).toBe("test-key");
      expect(new Headers(init?.headers).get("X-Goog-FieldMask")).toBeNull();
      return new Response(
        JSON.stringify({ photoUri: "https://lh3.googleusercontent.com/p/abc?key=AIzaSySecret" }),
        { status: 200 }
      );
    }) as typeof fetch;
    const provider = new GooglePlacesRestaurantProvider("test-key", fetchImpl);
    const url = await provider.getPhotoUrl(
      {
        provider: "google",
        providerPhotoId: "places/ChIJ-test/photos/abc"
      },
      { maxWidth: 800 }
    );
    expect(url).toBe("https://lh3.googleusercontent.com/p/abc");
    expect(url).not.toContain("AIza");
  });

  it("does not start the request with an already-aborted timeout signal", async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(false);
      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    }) as typeof fetch;
    const provider = new GooglePlacesRestaurantProvider("test-key", fetchImpl);
    const result = await provider.search({
      location: { latitude: 25.76, longitude: -80.19 },
      radiusMeters: 4000
    });
    expect(result.restaurants).toEqual([]);
  });

  it("translates rate limits without exposing the key", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: "quota AIzaSySecret" } }), {
        status: 429
      })) as typeof fetch;
    const provider = new GooglePlacesRestaurantProvider("AIzaSySecret", fetchImpl);
    await expect(
      provider.search({
        location: { latitude: 25.76, longitude: -80.19 },
        radiusMeters: 4000
      })
    ).rejects.toMatchObject({ code: ErrorCodes.PROVIDER_RATE_LIMITED });
  });
});
