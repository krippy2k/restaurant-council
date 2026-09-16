import type { DietaryAssessment } from "@rc/protocol";
import type { Restaurant } from "../domain.ts";
import { evidenceFromText } from "./extract.ts";
import { mockDietaryFixture } from "./mock-fixtures.ts";
import { assessDietaryEvidence } from "./rules.ts";
import { structuredEvidenceForRequirement } from "./structured.ts";
import type { DietaryAnalysisRequest, DietaryAnalyzer } from "./types.ts";

export class MockDietaryAnalyzer implements DietaryAnalyzer {
  async analyze(restaurant: Restaurant, request: DietaryAnalysisRequest): Promise<DietaryAssessment[]> {
    const fixture = mockDietaryFixture(restaurant);
    const mode = request.evidenceRequirement ?? "normal";
    return request.requirements.map((requirement) => {
      const evidence = [
        ...structuredEvidenceForRequirement(restaurant, requirement),
        ...evidenceFromText({
          text: fixture.officialAllergenText ?? "",
          requirement,
          sourceType: "official-allergen-info",
          sourceName: fixture.officialScope === "chain" ? "Corporate allergen guide" : "Restaurant allergen guide",
          reliability: "high",
          scope: fixture.officialScope ?? "location"
        }),
        ...evidenceFromText({
          text: fixture.websiteText ?? "",
          requirement,
          sourceType: "official-website",
          sourceName: restaurant.website ?? restaurant.name,
          sourceUrl: restaurant.website,
          reliability: "medium",
          scope: "location"
        })
      ];
      const hasAuthoritativeSupport = evidence.some(
        (item) => item.supports === "supports" && item.sourceType !== "review"
      );
      const officialContradicts = evidence.some((item) => item.supports === "contradicts");
      if (request.depth === "deep" || !hasAuthoritativeSupport || officialContradicts) {
        evidence.push(
          ...(fixture.reviews ?? []).flatMap((review) =>
            evidenceFromText({
              text: review.text,
              requirement,
              sourceType: "review",
              sourceName: "Guest review",
              observedAt: review.observedAt,
              reliability: "low",
              scope: "location"
            })
          )
        );
      }
      return assessDietaryEvidence({
        restaurantId: restaurant.id,
        requirement,
        evidence,
        evidenceRequirement: mode
      });
    });
  }
}
