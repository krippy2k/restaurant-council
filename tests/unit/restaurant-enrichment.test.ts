import { describe, expect, it } from "vitest";
import {
  assertSafePhotoUrl,
  clampPhotoDimension,
  formatRatingLabel,
  MemoryRestaurantCache,
  MockRestaurantProvider,
  normalizeRating,
  normalizeReviewCount,
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
});
