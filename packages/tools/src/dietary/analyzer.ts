import type { DietaryAssessment } from "@rc/protocol";
import type { Restaurant } from "../domain.ts";
import { officialWebsiteEvidence, reviewEvidence } from "./official.ts";
import { assessDietaryEvidence } from "./rules.ts";
import { structuredEvidenceForRequirement } from "./structured.ts";
import type { DietaryAnalysisRequest, DietaryAnalyzer } from "./types.ts";
import { fetchOfficialRestaurantText } from "./website.ts";

export class EvidenceDietaryAnalyzer implements DietaryAnalyzer {
  constructor(
    private readonly fetchText: (url: string) => Promise<string | null> = fetchOfficialRestaurantText
  ) {}

  async analyze(restaurant: Restaurant, request: DietaryAnalysisRequest): Promise<DietaryAssessment[]> {
    const mode = request.evidenceRequirement ?? "normal";
    const assessments: DietaryAssessment[] = [];
    for (const requirement of request.requirements) {
      const evidence = [
        ...structuredEvidenceForRequirement(restaurant, requirement),
        ...(await officialWebsiteEvidence(restaurant, requirement, this.fetchText)),
        ...(request.depth === "deep" ? reviewEvidence(restaurant, requirement) : [])
      ];
      assessments.push(
        assessDietaryEvidence({
          restaurantId: restaurant.id,
          requirement,
          evidence,
          evidenceRequirement: mode
        })
      );
    }
    return assessments;
  }
}
