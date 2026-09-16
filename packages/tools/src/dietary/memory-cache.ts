import type { DietaryAssessment, DietaryEvidenceRequirement } from "@rc/protocol";
import { dietaryCacheKey, type DietaryAssessmentCache } from "./types.ts";

export class MemoryDietaryCache implements DietaryAssessmentCache {
  private readonly entries = new Map<string, DietaryAssessment>();

  async get(key: string): Promise<DietaryAssessment | null> {
    const assessment = this.entries.get(key);
    if (!assessment) return null;
    if (assessment.expiresAt && Date.parse(assessment.expiresAt) <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return assessment;
  }

  async set(assessment: DietaryAssessment, evidenceRequirement: DietaryEvidenceRequirement): Promise<void> {
    this.entries.set(
      dietaryCacheKey(assessment.restaurantId, assessment.requirement, evidenceRequirement),
      assessment
    );
  }
}
