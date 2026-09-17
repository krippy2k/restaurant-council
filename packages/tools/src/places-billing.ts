export type PlacesOperation = "nearby-search" | "text-search" | "place-details" | "place-photos";

export type PlacesSkuTier =
  | "ids-only"
  | "essentials"
  | "pro"
  | "enterprise"
  | "enterprise-atmosphere";

export type PlacesCacheKind = "search" | "hours" | "details" | "photos";

export interface PlacesBillableRequest {
  operation: PlacesOperation;
  fieldMask: string;
  sku: string;
  estimatedUsd: number;
}

const TIER_RANK: Record<PlacesSkuTier, number> = {
  "ids-only": 0,
  essentials: 1,
  pro: 2,
  enterprise: 3,
  "enterprise-atmosphere": 4
};

/** List rates at the 0–100k monthly volume tier, USD per 1,000 calls. */
const USD_PER_THOUSAND: Record<string, number> = {
  "nearby-search:pro": 32,
  "nearby-search:enterprise": 35,
  "nearby-search:enterprise-atmosphere": 40,
  "text-search:pro": 32,
  "text-search:enterprise": 35,
  "text-search:enterprise-atmosphere": 40,
  "place-details:ids-only": 0,
  "place-details:essentials": 5,
  "place-details:pro": 17,
  "place-details:enterprise": 20,
  "place-details:enterprise-atmosphere": 25,
  "place-photos": 7
};

const DETAILS_FIELD_TIER: Record<string, PlacesSkuTier> = {
  id: "ids-only",
  photos: "ids-only",
  formattedAddress: "essentials",
  location: "essentials",
  types: "essentials",
  displayName: "pro",
  primaryType: "pro",
  timeZone: "pro",
  priceLevel: "enterprise",
  priceRange: "enterprise",
  rating: "enterprise",
  userRatingCount: "enterprise",
  websiteUri: "enterprise",
  nationalPhoneNumber: "enterprise",
  internationalPhoneNumber: "enterprise",
  currentOpeningHours: "enterprise",
  regularOpeningHours: "enterprise",
  outdoorSeating: "enterprise-atmosphere",
  reservable: "enterprise-atmosphere",
  servesVegetarianFood: "enterprise-atmosphere",
  reviews: "enterprise-atmosphere"
};

const SEARCH_FIELD_TIER: Record<string, PlacesSkuTier> = {
  id: "ids-only",
  displayName: "pro",
  formattedAddress: "pro",
  location: "pro",
  primaryType: "pro",
  types: "pro",
  photos: "pro",
  priceLevel: "enterprise",
  priceRange: "enterprise",
  rating: "enterprise",
  userRatingCount: "enterprise",
  websiteUri: "enterprise",
  nationalPhoneNumber: "enterprise",
  internationalPhoneNumber: "enterprise",
  currentOpeningHours: "enterprise",
  regularOpeningHours: "enterprise",
  outdoorSeating: "enterprise-atmosphere",
  reservable: "enterprise-atmosphere",
  servesVegetarianFood: "enterprise-atmosphere",
  reviews: "enterprise-atmosphere"
};

const SKU_LABEL: Record<string, string> = {
  "nearby-search:pro": "Nearby Search Pro",
  "nearby-search:enterprise": "Nearby Search Enterprise",
  "nearby-search:enterprise-atmosphere": "Nearby Search Enterprise + Atmosphere",
  "text-search:pro": "Text Search Pro",
  "text-search:enterprise": "Text Search Enterprise",
  "text-search:enterprise-atmosphere": "Text Search Enterprise + Atmosphere",
  "place-details:ids-only": "Place Details Essentials (IDs Only)",
  "place-details:essentials": "Place Details Essentials",
  "place-details:pro": "Place Details Pro",
  "place-details:enterprise": "Place Details Enterprise",
  "place-details:atmosphere": "Place Details Enterprise + Atmosphere",
  "place-details:enterprise-atmosphere": "Place Details Enterprise + Atmosphere",
  "place-photos": "Place Details Photos"
};

function roundUsd(amount: number): number {
  return Math.round(amount * 1_000_000) / 1_000_000;
}

function fieldNames(fieldMask: string): string[] {
  return fieldMask
    .split(",")
    .map((item) => item.trim().replace(/^places\./, ""))
    .filter(Boolean);
}

function highestTier(fields: string[], table: Record<string, PlacesSkuTier>, fallback: PlacesSkuTier): PlacesSkuTier {
  let best = fallback;
  for (const field of fields) {
    const tier = table[field];
    if (!tier) continue;
    if (TIER_RANK[tier] > TIER_RANK[best]) best = tier;
  }
  return best;
}

export function placesOperationFromUrl(url: string): PlacesOperation {
  if (url.includes("/media") || url.includes(":getMedia")) return "place-photos";
  if (url.includes("places:searchNearby")) return "nearby-search";
  if (url.includes("places:searchText")) return "text-search";
  return "place-details";
}

export function estimatePlacesRequest(url: string, fieldMask = ""): PlacesBillableRequest {
  const operation = placesOperationFromUrl(url);
  if (operation === "place-photos") {
    return {
      operation,
      fieldMask,
      sku: SKU_LABEL["place-photos"] ?? "Place Details Photos",
      estimatedUsd: roundUsd((USD_PER_THOUSAND["place-photos"] ?? 7) / 1000)
    };
  }
  const fields = fieldNames(fieldMask);
  const table = operation === "place-details" ? DETAILS_FIELD_TIER : SEARCH_FIELD_TIER;
  const fallback: PlacesSkuTier = operation === "place-details" ? "essentials" : "pro";
  const nearbyIdOnlyIsPro = operation === "nearby-search";
  const tier = highestTier(fields, table, nearbyIdOnlyIsPro ? "pro" : fallback);
  const key = `${operation}:${tier}`;
  return {
    operation,
    fieldMask,
    sku: SKU_LABEL[key] ?? key,
    estimatedUsd: roundUsd((USD_PER_THOUSAND[key] ?? USD_PER_THOUSAND[`${operation}:pro`] ?? 32) / 1000)
  };
}
