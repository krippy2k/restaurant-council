import { describe, expect, it } from "vitest";
import {
  formatRestaurantPrice,
  inferPriceLevelFromRange,
  typicalPriceRangeFromLevel
} from "@rc/tools";

describe("restaurant price display", () => {
  it("prefers a dollar range over $ symbols", () => {
    expect(
      formatRestaurantPrice({
        priceLevel: 2,
        priceRange: { startAmount: 18, endAmount: 35, currencyCode: "USD" }
      })
    ).toEqual({ primary: "$18–$35" });
  });

  it("formats an open-ended range", () => {
    expect(
      formatRestaurantPrice({
        priceRange: { startAmount: 60, currencyCode: "USD" }
      })
    ).toEqual({ primary: "$60+" });
  });

  it("falls back to $ symbols with a typical range", () => {
    expect(formatRestaurantPrice({ priceLevel: 2 })).toEqual({
      primary: "$$",
      detail: "typically $15–$30"
    });
  });

  it("infers council price levels from dollar amounts", () => {
    expect(inferPriceLevelFromRange({ endAmount: 12 })).toBe(1);
    expect(inferPriceLevelFromRange({ startAmount: 18, endAmount: 28 })).toBe(2);
    expect(inferPriceLevelFromRange({ startAmount: 40, endAmount: 55 })).toBe(3);
    expect(inferPriceLevelFromRange({ startAmount: 80 })).toBe(4);
  });

  it("uses typical ranges for mock price levels", () => {
    expect(typicalPriceRangeFromLevel(2)).toEqual({
      startAmount: 15,
      endAmount: 30,
      currencyCode: "USD"
    });
  });
});
