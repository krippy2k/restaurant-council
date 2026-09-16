import type { DietaryAssessment, DietaryConstraint, DietaryEvidence, DietaryEvidenceRequirement } from "@rc/protocol";
import type { Restaurant } from "../domain.ts";

export interface DietaryAnalysisRequest {
  requirements: string[];
  evidenceRequirement?: DietaryEvidenceRequirement;
  depth?: "basic" | "deep";
}

export interface DietaryAnalyzer {
  analyze(restaurant: Restaurant, request: DietaryAnalysisRequest): Promise<DietaryAssessment[]>;
}

export interface DietaryAnalysisMetrics {
  dietary_analysis_requests: number;
  dietary_analysis_cache_hits: number;
  dietary_analysis_cache_misses: number;
  dietary_evidence_sources_checked: number;
  dietary_analysis_confirmed: number;
  dietary_analysis_likely: number;
  dietary_analysis_uncertain: number;
  dietary_analysis_unsupported: number;
  dietary_analysis_conflicting: number;
  dietary_analysis_failures: number;
}

export function emptyDietaryMetrics(): DietaryAnalysisMetrics {
  return {
    dietary_analysis_requests: 0,
    dietary_analysis_cache_hits: 0,
    dietary_analysis_cache_misses: 0,
    dietary_evidence_sources_checked: 0,
    dietary_analysis_confirmed: 0,
    dietary_analysis_likely: 0,
    dietary_analysis_uncertain: 0,
    dietary_analysis_unsupported: 0,
    dietary_analysis_conflicting: 0,
    dietary_analysis_failures: 0
  };
}

export function recordAssessmentMetric(metrics: DietaryAnalysisMetrics, assessment: DietaryAssessment): void {
  if (assessment.status === "confirmed") metrics.dietary_analysis_confirmed += 1;
  else if (assessment.status === "likely") metrics.dietary_analysis_likely += 1;
  else if (assessment.status === "uncertain") metrics.dietary_analysis_uncertain += 1;
  else if (assessment.status === "unsupported") metrics.dietary_analysis_unsupported += 1;
  else metrics.dietary_analysis_conflicting += 1;
}

export interface DietaryAssessmentCache {
  get(key: string): Promise<DietaryAssessment | null>;
  set(assessment: DietaryAssessment, evidenceRequirement: DietaryEvidenceRequirement): Promise<void>;
}

export function dietaryCacheKey(
  restaurantId: string,
  requirement: string,
  evidenceRequirement: DietaryEvidenceRequirement = "normal"
): string {
  return `${restaurantId}:${requirement}:${evidenceRequirement}`;
}

export type { DietaryConstraint, DietaryEvidence };
