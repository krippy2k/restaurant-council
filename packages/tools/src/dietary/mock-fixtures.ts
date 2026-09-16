import type { DietaryEvidence } from "@rc/protocol";
import type { Restaurant } from "../domain.ts";
import { nowIso } from "@rc/shared";
import { makeEvidence } from "./rules.ts";

export interface MockDietaryFixture {
  restaurantId: string;
  websiteText?: string;
  officialAllergenText?: string;
  officialScope?: "location" | "chain";
  reviews?: Array<{ text: string; observedAt?: string }>;
}

const FIXTURES: Record<string, MockDietaryFixture> = {
  res_greenleaf: {
    restaurantId: "res_greenleaf",
    officialAllergenText:
      "Dairy-free and gluten-free options are marked on the menu. We can accommodate dairy-free substitutions.",
    websiteText: "Vegetarian restaurant with vegan bowls and dairy-free oat-milk lattes.",
    reviews: [{ text: "Great DF options and the staff marked allergens clearly.", observedAt: nowIso() }]
  },
  res_ember: {
    restaurantId: "res_ember",
    websiteText: "Wood-fired pizza and pasta. We cannot accommodate gluten-free or dairy-free requests.",
    reviews: [{ text: "Told us they cannot do dairy-free pizza.", observedAt: nowIso() }]
  },
  res_harbor: {
    restaurantId: "res_harbor",
    websiteText: "Seasonal seafood. Ask about substitutions.",
    reviews: [
      { text: "The grilled salmon with vegetables was excellent.", observedAt: nowIso() },
      { text: "Loved the steak frites.", observedAt: nowIso() }
    ]
  },
  res_nightmarket: {
    restaurantId: "res_nightmarket",
    websiteText: "Vegan tasting menu. All dishes are plant-based.",
    officialAllergenText: "Vegan kitchen. Dairy is not used."
  },
  res_joes: {
    restaurantId: "res_joes",
    websiteText: "Classic New York slices. Cheese pizza is our specialty.",
    reviews: [{ text: "No dairy-free cheese available when we asked.", observedAt: nowIso() }]
  },
  res_vegan_only: {
    restaurantId: "res_vegan_only",
    websiteText: "Vegan burgers and bowls are available on the menu.",
    officialAllergenText: "Vegan dishes are marked on the menu."
  },
  res_reviews_df: {
    restaurantId: "res_reviews_df",
    reviews: [
      { text: "They happily made dairy-free substitutions for our table.", observedAt: nowIso() },
      { text: "Asked for DF pasta and they had a dairy-free option.", observedAt: nowIso() }
    ]
  },
  res_old_review: {
    restaurantId: "res_old_review",
    reviews: [
      {
        text: "They made my meal dairy-free years ago.",
        observedAt: "2018-03-01T00:00:00.000Z"
      }
    ]
  },
  res_none: {
    restaurantId: "res_none",
    websiteText: "Neighborhood bistro. Seasonal plates."
  },
  res_conflict: {
    restaurantId: "res_conflict",
    officialAllergenText: "We cannot accommodate gluten-free preparation.",
    reviews: [{ text: "They made my meal gluten free last week.", observedAt: nowIso() }]
  },
  res_gf_cross: {
    restaurantId: "res_gf_cross",
    officialAllergenText: "Gluten-free menu available. Shared fryer and cross-contact in the kitchen.",
    websiteText: "GF pizza and pasta are marked on the menu."
  },
  res_chain: {
    restaurantId: "res_chain",
    officialAllergenText: "Corporate allergen guide: dairy-free options at all locations.",
    officialScope: "chain"
  },
  res_location: {
    restaurantId: "res_location",
    officialAllergenText: "This location marks dairy-free dishes on the printed menu.",
    officialScope: "location"
  }
};

export function mockDietaryFixture(restaurant: Restaurant): MockDietaryFixture {
  const named = FIXTURES[restaurant.id] ?? FIXTURES[restaurant.providerId ?? ""] ?? FIXTURES[slugName(restaurant.name)];
  if (named) return named;
  const options = [
    ...(restaurant.cuisines ?? []),
    restaurant.attributes?.vegetarian ? "vegetarian" : "",
    ...(((restaurant.providerMetadata?.dietaryOptions as string[] | undefined) ?? []))
  ]
    .filter(Boolean)
    .join(" ");
  const highlights = ((restaurant.providerMetadata?.menuHighlights as string[] | undefined) ?? []).join(". ");
  return {
    restaurantId: restaurant.id,
    websiteText: [restaurant.website ? `${restaurant.name} menu.` : "", options, highlights]
      .filter(Boolean)
      .join(" "),
    reviews: (restaurant.reviews ?? []).map((review) => ({
      text: review.text ?? "",
      observedAt: review.publishedAt
    }))
  };
}

function slugName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function evidenceFromFixture(fixture: MockDietaryFixture, requirement: string): DietaryEvidence[] {
  const evidence: DietaryEvidence[] = [];
  if (fixture.officialAllergenText) {
    evidence.push(
      makeEvidence({
        sourceType: "official-allergen-info",
        sourceName: "Restaurant allergen guide",
        excerpt: fixture.officialAllergenText,
        supports: /cannot|can't|unable/i.test(fixture.officialAllergenText) ? "contradicts" : "supports",
        reliability: "high",
        scope: "location"
      })
    );
  }
  return evidence.filter((item) => {
    const hay = `${item.excerpt ?? ""} ${requirement}`;
    if (requirement === "dairy-free") return /dairy|lactose|vegan|df/i.test(hay);
    if (requirement === "gluten-free") return /gluten|gf/i.test(hay);
    if (requirement === "vegan") return /vegan/i.test(hay);
    if (requirement === "vegetarian") return /vegetarian|vegan/i.test(hay);
    return true;
  });
}
