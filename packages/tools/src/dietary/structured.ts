import type { DietaryEvidence } from "@rc/protocol";
import type { Restaurant } from "../domain.ts";
import { makeEvidence } from "./rules.ts";

export function structuredDietaryEvidence(restaurant: Restaurant): DietaryEvidence[] {
  const evidence: DietaryEvidence[] = [];
  const vegetarian =
    restaurant.attributes?.vegetarian === true ||
    restaurant.cuisines.some((item) => /vegetarian/i.test(item)) ||
    restaurant.primaryType === "vegetarian_restaurant";
  const vegan =
    restaurant.cuisines.some((item) => /vegan/i.test(item)) || restaurant.primaryType === "vegan_restaurant";

  if (vegetarian) {
    evidence.push(
      makeEvidence({
        sourceType: "structured-provider",
        sourceName: "Restaurant provider",
        supports: "supports",
        reliability: "high",
        scope: "location",
        excerpt: "Provider lists vegetarian options."
      })
    );
  }
  if (vegan) {
    evidence.push(
      makeEvidence({
        sourceType: "structured-provider",
        sourceName: "Restaurant provider",
        supports: "supports",
        reliability: "high",
        scope: "location",
        excerpt: "Provider lists vegan options."
      })
    );
  }
  return evidence;
}

export function structuredEvidenceForRequirement(
  restaurant: Restaurant,
  requirement: string
): DietaryEvidence[] {
  const all = structuredDietaryEvidence(restaurant);
  if (requirement === "vegetarian") {
    return all.filter((item) => /vegetarian/i.test(item.excerpt ?? ""));
  }
  if (requirement === "vegan") {
    return all.filter((item) => /vegan/i.test(item.excerpt ?? ""));
  }
  if (requirement === "dairy-free") {
    return all.filter((item) => /vegan/i.test(item.excerpt ?? ""));
  }
  return [];
}
