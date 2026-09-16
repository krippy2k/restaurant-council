import type { DietaryEvidence } from "@rc/protocol";
import type { Restaurant } from "../domain.ts";
import { evidenceFromText } from "./extract.ts";

export async function officialWebsiteEvidence(
  restaurant: Restaurant,
  requirement: string,
  fetchText: (url: string) => Promise<string | null>
): Promise<DietaryEvidence[]> {
  if (!restaurant.website) return [];
  const text = await fetchText(restaurant.website);
  if (!text) return [];
  return evidenceFromText({
    text,
    requirement,
    sourceType: "official-website",
    sourceName: restaurant.name,
    sourceUrl: restaurant.website,
    reliability: "medium",
    scope: "location"
  });
}

export function reviewEvidence(restaurant: Restaurant, requirement: string): DietaryEvidence[] {
  return (restaurant.reviews ?? []).flatMap((review) =>
    evidenceFromText({
      text: review.text ?? "",
      requirement,
      sourceType: "review",
      sourceName: review.authorName ?? "Guest review",
      observedAt: review.publishedAt,
      reliability: "low",
      scope: "location"
    })
  );
}
