import { describe, expect, it } from "vitest";
import {
  assertSafePhotoUrl,
  clampPhotoDimension,
  formatRatingLabel,
  MemoryRestaurantCache,
  MockRestaurantProvider,
  normalizeRating,
  normalizeReviewCount,
  mergePhotos,
  photosFromGoogle,
  ratingAriaLabel,
  reputationBonus,
  reviewsFromGoogle,
  RestaurantSearchService,
  selectPrimaryPhoto
} from "@rc/tools";

describe("rating normalization", () => {
  it("drops missing and non-positive ratings", () => {
    expect(normalizeRating(undefined)).toBeUndefined();
    expect(normalizeRating(0)).toBeUndefined();
    expect(normalizeRating(-1)).toBeUndefined();
    expect(normalizeRating("nope")).toBeUndefined();
    expect(normalizeRating(4.62)).toBe(4.6);
  });

  it("normalizes review counts", () => {
    expect(normalizeReviewCount(undefined)).toBeUndefined();
    expect(normalizeReviewCount(-3)).toBeUndefined();
    expect(normalizeReviewCount(2143.2)).toBe(2143);
  });
});

describe("rating labels", () => {
  it("formats rating and count without fabricating zeros", () => {
    expect(formatRatingLabel(4.6, 2143)).toBe("★ 4.6 (2,143)");
    expect(formatRatingLabel(4.6)).toBe("★ 4.6");
    expect(formatRatingLabel(undefined, 12)).toBe("No rating available");
    expect(formatRatingLabel(0, 0)).toBe("No rating available");
    expect(ratingAriaLabel(4.6, 2143)).toBe("Rated 4.6 out of 5 from 2,143 ratings");
  });
});

describe("photo and review mapping", () => {
  it("keeps attribution and skips empty photos", () => {
    const photos = photosFromGoogle([
      {
        name: "places/ChIJ/photos/abc",
        widthPx: 1600,
        heightPx: 900,
        authorAttributions: [{ displayName: "Alex R." }]
      },
      { widthPx: 100 }
    ]);
    expect(photos).toHaveLength(1);
    expect(photos?.[0]?.providerPhotoId).toBe("places/ChIJ/photos/abc");
    expect(photos?.[0]?.attribution).toBe("Alex R.");
    expect(selectPrimaryPhoto(photos)?.providerPhotoId).toBe("places/ChIJ/photos/abc");
  });

  it("keeps earlier photos when a later copy is empty", () => {
    const kept = mergePhotos(
      undefined,
      [{ provider: "google", providerPhotoId: "places/ChIJ/photos/keep", width: 800, height: 600 }]
    );
    expect(kept?.[0]?.providerPhotoId).toBe("places/ChIJ/photos/keep");
  });

  it("unions photo ids instead of replacing a richer set", () => {
    const merged = mergePhotos(
      [{ provider: "google", providerPhotoId: "places/ChIJ/photos/new" }],
      [
        { provider: "google", providerPhotoId: "places/ChIJ/photos/old" },
        { provider: "google", providerPhotoId: "places/ChIJ/photos/new" }
      ]
    );
    expect(merged?.map((item) => item.providerPhotoId)).toEqual([
      "places/ChIJ/photos/new",
      "places/ChIJ/photos/old"
    ]);
  });

  it("does not invent review authors or text", () => {
    const reviews = reviewsFromGoogle([
      {
        name: "places/ChIJ/reviews/1",
        rating: 5,
        text: { text: "Excellent steaks and great service." },
        authorAttribution: { displayName: "Alex R." },
        relativePublishTimeDescription: "a month ago"
      },
      { rating: 0 }
    ]);
    expect(reviews).toHaveLength(1);
    expect(reviews?.[0]?.text).toBe("Excellent steaks and great service.");
    expect(reviews?.[0]?.authorName).toBe("Alex R.");
    expect(reviews?.[0]?.attribution).toBe("Alex R.");
  });
});

describe("photo options", () => {
  it("clamps provider photo dimensions", () => {
    expect(clampPhotoDimension(0)).toBe(1);
    expect(clampPhotoDimension(99999)).toBe(4800);
    expect(clampPhotoDimension(800)).toBe(800);
  });
});

describe("photo URL safety", () => {
  it("strips keys and rejects non-https", () => {
    expect(assertSafePhotoUrl("https://lh3.googleusercontent.com/p/abc?key=AIzaSySecret")).toBe(
      "https://lh3.googleusercontent.com/p/abc"
    );
    expect(() => assertSafePhotoUrl("http://evil.example/photo")).toThrow(/rejected|invalid/i);
  });
});

describe("reputation confidence", () => {
  it("does not prefer a 4.9 with 8 ratings over a 4.7 with thousands", () => {
    const thin = reputationBonus(4.9, 8);
    const established = reputationBonus(4.7, 2500);
    expect(established).toBeGreaterThan(thin);
    expect(established).toBeLessThanOrEqual(8);
  });
});

describe("mock provider enrichment", () => {
  it("includes photos, ratings, and reviews without Google", async () => {
    const provider = new MockRestaurantProvider();
    const cache = new MemoryRestaurantCache();
    const service = new RestaurantSearchService(provider, cache);
    const result = await service.search({
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000
    });
    const stk = result.restaurants.find((item) => item.name === "STK");
    expect(stk?.rating).toBe(4.4);
    expect(stk?.reviewCount).toBe(2143);
    expect(stk?.photos?.[0]?.provider).toBe("mock");
    expect(stk?.reviews).toBeUndefined();
    const details = await service.getDetails(stk?.id ?? "");
    expect(details.reviews?.length).toBeGreaterThan(0);
    expect(details.reviews?.[0]?.text).toContain("steaks");
    const plain = result.restaurants.find((item) => item.name === "Plain Bowl");
    expect(plain?.rating).toBeUndefined();
    expect(plain?.photos).toBeUndefined();
    const photo = await service.resolvePhoto(stk!.id, stk!.photos![0]!.providerPhotoId);
    expect(photo.kind).toBe("bytes");
    if (photo.kind === "bytes") {
      expect(photo.contentType).toContain("image/svg+xml");
      expect(photo.body).toContain("STK");
    }
  });

  it("keeps cached photos when a later search omits them", async () => {
    const provider = new MockRestaurantProvider();
    const cache = new MemoryRestaurantCache();
    const service = new RestaurantSearchService(provider, cache);
    const first = await service.search({
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000
    });
    const stk = first.restaurants.find((item) => item.name === "STK");
    expect(stk?.photos?.[0]).toBeTruthy();
    const extra = {
      provider: "mock" as const,
      providerPhotoId: "mock-photo-kept",
      width: 800,
      height: 600
    };
    await cache.putRestaurant({
      ...stk!,
      photos: [extra]
    });
    const second = await service.search({
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 9000
    });
    const again = second.restaurants.find((item) => item.name === "STK");
    expect(again?.photos?.some((item) => item.providerPhotoId === extra.providerPhotoId)).toBe(true);
  });

  it("still resolves a photo id after the cache list was replaced", async () => {
    const provider = new MockRestaurantProvider();
    const cache = new MemoryRestaurantCache();
    const service = new RestaurantSearchService(provider, cache);
    const result = await service.search({
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000
    });
    const stk = result.restaurants.find((item) => item.name === "STK");
    const photoId = stk!.photos![0]!.providerPhotoId;
    await cache.putRestaurant({ ...stk!, photos: [] });
    const photo = await service.resolvePhoto(stk!.id, photoId);
    expect(photo.kind).toBe("bytes");
  });

  it("does not refetch hours from the provider within a week", async () => {
    class CountingProvider extends MockRestaurantProvider {
      detailsCalls = 0;
      override async getDetails(id: string, options?: { hoursOnly?: boolean }) {
        this.detailsCalls += 1;
        return super.getDetails(id, options);
      }
    }
    const provider = new CountingProvider();
    const cache = new MemoryRestaurantCache();
    const service = new RestaurantSearchService(provider, cache);
    const result = await service.search({
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000
    });
    const stk = result.restaurants.find((item) => item.name === "STK");
    const first = await service.getHours(stk?.id ?? "");
    const second = await service.getHours(stk?.id ?? "");
    expect(first.cacheHit).toBe(true);
    expect(second.cacheHit).toBe(true);
    expect(provider.detailsCalls).toBe(0);
  });

  it("refetches hours after the week-long cache expires", async () => {
    class CountingProvider extends MockRestaurantProvider {
      detailsCalls = 0;
      override async getDetails(id: string, options?: { hoursOnly?: boolean }) {
        this.detailsCalls += 1;
        return super.getDetails(id, options);
      }
    }
    const provider = new CountingProvider();
    const cache = new MemoryRestaurantCache();
    const service = new RestaurantSearchService(provider, cache);
    const result = await service.search({
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000
    });
    const stk = result.restaurants.find((item) => item.name === "STK");
    await cache.putRestaurant({
      ...stk!,
      openingHours: {
        ...stk!.openingHours,
        retrievedAt: "2026-01-01T00:00:00.000Z"
      }
    });
    const hours = await service.getHours(stk!.id);
    expect(hours.cacheHit).toBe(false);
    expect(provider.detailsCalls).toBe(1);
  });

  it("does not refetch full details when the same fields are still cached", async () => {
    class CountingProvider extends MockRestaurantProvider {
      detailsCalls = 0;
      override async getDetails(id: string, options?: { hoursOnly?: boolean }) {
        this.detailsCalls += 1;
        return super.getDetails(id, options);
      }
    }
    const provider = new CountingProvider();
    const cache = new MemoryRestaurantCache();
    const service = new RestaurantSearchService(provider, cache);
    const result = await service.search({
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000
    });
    const stk = result.restaurants.find((item) => item.name === "STK");
    const first = await service.getDetails(stk!.id);
    const second = await service.getDetails(stk!.id);
    expect(first.reviews?.length).toBeGreaterThan(0);
    expect(second.reviews).toEqual(first.reviews);
    expect(provider.detailsCalls).toBe(1);
  });

  it("reports details cache hits to the spend callback", async () => {
    const cached: string[] = [];
    const cache = new MemoryRestaurantCache();
    const service = new RestaurantSearchService(new MockRestaurantProvider(), cache, {
      onPlacesCacheHit: (kind) => cached.push(kind)
    });
    const result = await service.search({
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000
    });
    const stk = result.restaurants.find((item) => item.name === "STK");
    await service.getDetails(stk!.id);
    await service.getDetails(stk!.id);
    await service.getHours(stk!.id);
    expect(cached).toEqual(["details", "hours"]);
  });

  it("fetches full details after an hours-only lookup because more fields are needed", async () => {
    class CountingProvider extends MockRestaurantProvider {
      detailsCalls = 0;
      override async getDetails(id: string, options?: { hoursOnly?: boolean }) {
        this.detailsCalls += 1;
        return super.getDetails(id, options);
      }
    }
    const provider = new CountingProvider();
    const cache = new MemoryRestaurantCache();
    const service = new RestaurantSearchService(provider, cache);
    const result = await service.search({
      location: { latitude: 40.758, longitude: -73.9855 },
      radiusMeters: 8000
    });
    const stk = result.restaurants.find((item) => item.name === "STK");
    await cache.putRestaurant({
      ...stk!,
      detailsCoverage: "hours",
      detailsRetrievedAt: new Date().toISOString(),
      openingHours: { ...stk!.openingHours, retrievedAt: new Date().toISOString() }
    });
    await service.getHours(stk!.id);
    expect(provider.detailsCalls).toBe(0);
    await service.getDetails(stk!.id);
    expect(provider.detailsCalls).toBe(1);
    await service.getDetails(stk!.id);
    await service.getHours(stk!.id);
    expect(provider.detailsCalls).toBe(1);
  });
});
