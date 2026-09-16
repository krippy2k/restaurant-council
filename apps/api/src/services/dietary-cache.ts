import type { DietaryAssessment, DietaryEvidenceRequirement } from "@rc/protocol";
import type { DietaryAssessmentCache } from "@rc/tools";
import type { Database } from "../db/database.ts";

export class D1DietaryCache implements DietaryAssessmentCache {
  constructor(private readonly db: Database) {}

  async get(key: string): Promise<DietaryAssessment | null> {
    const [restaurantId, requirement, mode] = splitDietaryKey(key);
    if (!restaurantId || !requirement || !mode) return null;
    return this.db.getDietaryAssessment(restaurantId, requirement, mode);
  }

  async set(assessment: DietaryAssessment, evidenceRequirement: DietaryEvidenceRequirement): Promise<void> {
    await this.db.saveDietaryAssessment(assessment, evidenceRequirement);
  }
}

function splitDietaryKey(key: string): [string | undefined, string | undefined, string | undefined] {
  const parts = key.split(":");
  if (parts.length < 3) return [undefined, undefined, undefined];
  const mode = parts.at(-1);
  const requirement = parts.at(-2);
  const restaurantId = parts.slice(0, -2).join(":");
  return [restaurantId, requirement, mode];
}
