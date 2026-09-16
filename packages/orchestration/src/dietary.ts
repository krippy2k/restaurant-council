import type { Principal } from "@rc/auth";
import type { CouncilConstraint, RestaurantCandidate } from "@rc/protocol";
import { dietaryConstraintsFromCouncil } from "@rc/protocol";
import {
  candidateAsRestaurant,
  uncertainAssessment,
  type DietaryAnalyzer,
  type RestaurantSearchTool
} from "@rc/tools";

export async function attachDietaryAssessments(input: {
  candidates: RestaurantCandidate[];
  constraints: CouncilConstraint[];
  analyzer?: DietaryAnalyzer;
  restaurants?: RestaurantSearchTool;
  principal?: Principal;
  depth?: "basic" | "deep";
}): Promise<RestaurantCandidate[]> {
  const requirements = dietaryConstraintsFromCouncil(input.constraints);
  if (!input.analyzer || requirements.length === 0) return input.candidates;

  const mode = requirements.some((item) => item.evidenceRequirement === "strict") ? "strict" : "normal";
  const ids = [...new Set(requirements.map((item) => item.requirement))];
  const next: RestaurantCandidate[] = [];

  for (const candidate of input.candidates) {
    let restaurant = candidateAsRestaurant(candidate);
    if (input.depth === "deep" && input.restaurants && input.principal) {
      try {
        const details = await input.restaurants.getRestaurant(candidate.id, input.principal);
        restaurant = candidateAsRestaurant({ ...candidate, ...details });
      } catch {
        // Keep discovery-level fields if details lookup fails.
      }
    }
    try {
      const assessments = await input.analyzer.analyze(restaurant, {
        requirements: ids,
        evidenceRequirement: mode,
        depth: input.depth
      });
      next.push({ ...candidate, dietaryAssessments: assessments });
    } catch {
      next.push({
        ...candidate,
        dietaryAssessments: ids.map((requirement) => uncertainAssessment(candidate.id, requirement))
      });
    }
  }
  return next;
}

export function promisingForDeepDietary(
  candidates: RestaurantCandidate[],
  limit = 8
): RestaurantCandidate[] {
  return [...candidates]
    .filter((candidate) =>
      (candidate.dietaryAssessments ?? []).some(
        (item) => item.status === "uncertain" || item.status === "likely" || item.status === "conflicting"
      )
    )
    .slice(0, limit);
}
