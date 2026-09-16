import type { DietaryAssessment } from "@rc/protocol";
import type { Restaurant } from "../domain.ts";
import { uncertainAssessment } from "./rules.ts";
import {
  dietaryCacheKey,
  emptyDietaryMetrics,
  recordAssessmentMetric,
  type DietaryAnalysisMetrics,
  type DietaryAnalysisRequest,
  type DietaryAnalyzer,
  type DietaryAssessmentCache
} from "./types.ts";

export class CachingDietaryAnalyzer implements DietaryAnalyzer {
  readonly metrics: DietaryAnalysisMetrics = emptyDietaryMetrics();

  constructor(
    private readonly inner: DietaryAnalyzer,
    private readonly cache?: DietaryAssessmentCache
  ) {}

  async analyze(restaurant: Restaurant, request: DietaryAnalysisRequest): Promise<DietaryAssessment[]> {
    this.metrics.dietary_analysis_requests += 1;
    const mode = request.evidenceRequirement ?? "normal";
    const results: DietaryAssessment[] = [];
    const missing: string[] = [];

    for (const requirement of request.requirements) {
      const cached = this.cache ? await this.cache.get(dietaryCacheKey(restaurant.id, requirement, mode)) : null;
      if (cached && (!cached.expiresAt || Date.parse(cached.expiresAt) > Date.now())) {
        this.metrics.dietary_analysis_cache_hits += 1;
        recordAssessmentMetric(this.metrics, cached);
        results.push(cached);
      } else {
        this.metrics.dietary_analysis_cache_misses += 1;
        missing.push(requirement);
      }
    }

    if (missing.length) {
      try {
        const fresh = await this.inner.analyze(restaurant, { ...request, requirements: missing });
        for (const assessment of fresh) {
          this.metrics.dietary_evidence_sources_checked += assessment.evidence.length;
          recordAssessmentMetric(this.metrics, assessment);
          results.push(assessment);
          await this.cache?.set(assessment, mode);
        }
      } catch {
        this.metrics.dietary_analysis_failures += 1;
        for (const requirement of missing) {
          results.push(uncertainAssessment(restaurant.id, requirement));
        }
      }
    }

    return request.requirements.map(
      (requirement) =>
        results.find((item) => item.requirement === requirement) ??
        uncertainAssessment(restaurant.id, requirement)
    );
  }
}
