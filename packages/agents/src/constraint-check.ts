import type { CouncilConstraint, RestaurantCandidate } from "@rc/protocol";
import { dietaryConstraintOutcome, parseDietaryConstraints } from "@rc/protocol";

export type ConstraintAssessment =
  | { kind: "skip"; actual?: unknown }
  | { kind: "pass" }
  | { kind: "fail"; actual: unknown }
  | { kind: "soft" }
  | { kind: "bonus"; points: number };

function inferredPriceLevel(typical?: number): number | undefined {
  if (typical == null || !Number.isFinite(typical) || typical < 0) return undefined;
  if (typical <= 15) return 1;
  if (typical <= 30) return 2;
  if (typical <= 60) return 3;
  return 4;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

export function assessConstraint(
  constraint: CouncilConstraint,
  candidate: RestaurantCandidate
): ConstraintAssessment {
  switch (constraint.type) {
    case "MAX_PRICE_LEVEL": {
      const max = Number(constraint.value);
      const level =
        candidate.priceLevel ??
        inferredPriceLevel(candidate.priceRange?.endAmount ?? candidate.priceRange?.startAmount);
      if (level == null) {
        return {
          kind: "skip",
          actual: { priceLevel: candidate.priceLevel, priceRange: candidate.priceRange }
        };
      }
      if (level > max) {
        return {
          kind: "fail",
          actual: {
            priceLevel: candidate.priceLevel ?? level,
            priceRange: candidate.priceRange
          }
        };
      }
      return { kind: "pass" };
    }
    case "MIN_RATING": {
      const min = Number(constraint.value);
      if (candidate.rating == null) return { kind: "skip" };
      if (candidate.rating < min) {
        return constraint.priority === "HARD" ? { kind: "fail", actual: candidate.rating } : { kind: "soft" };
      }
      return { kind: "pass" };
    }
    case "CUISINE_PREFER": {
      const wanted = asStringArray(constraint.value);
      if (wanted.some((item) => candidate.cuisines.includes(item))) return { kind: "pass" };
      return { kind: "soft" };
    }
    case "CUISINE_AVOID": {
      const avoided = asStringArray(constraint.value);
      if (avoided.some((item) => candidate.cuisines.includes(item))) {
        return { kind: "fail", actual: candidate.cuisines };
      }
      return { kind: "pass" };
    }
    case "DIETARY": {
      const needs = parseDietaryConstraints(constraint.value);
      if (needs.length === 0) return { kind: "skip" };
      const assessments = candidate.dietaryAssessments ?? [];
      let skipped = false;
      let soft = false;
      const actual = needs.map((need) => {
        const assessment = assessments.find((item) => item.requirement === need.requirement);
        return {
          requirement: need.requirement,
          status: assessment?.status ?? "uncertain"
        };
      });
      for (const need of needs) {
        const assessment = assessments.find((item) => item.requirement === need.requirement);
        const outcome = dietaryConstraintOutcome(need, assessment);
        if (outcome === "fail") return { kind: "fail", actual };
        if (outcome === "soft") soft = true;
        if (outcome === "skip") skipped = true;
      }
      if (soft) return { kind: "soft" };
      if (skipped) return { kind: "skip", actual };
      return { kind: "pass" };
    }
    case "ACCESSIBILITY": {
      const needs = asStringArray(constraint.value);
      const options = candidate.accessibility ?? [];
      if (needs.every((need) => options.includes(need))) return { kind: "pass" };
      return { kind: "fail", actual: options };
    }
    case "MAX_DISTANCE_KM": {
      const max = Number(constraint.value);
      const distance = candidate.distanceKm ?? 0;
      if (distance > max) return { kind: "fail", actual: distance };
      return { kind: "pass" };
    }
    case "OUTDOOR_SEATING": {
      if (constraint.value === true && !candidate.outdoorSeating) {
        return constraint.priority === "HARD"
          ? { kind: "fail", actual: false }
          : { kind: "soft" };
      }
      return { kind: "pass" };
    }
    case "AVOID_RESTAURANT": {
      const names = asStringArray(constraint.value).map((name) => name.toLowerCase());
      if (names.some((name) => candidate.name.toLowerCase().includes(name))) {
        return { kind: "fail", actual: candidate.name };
      }
      return { kind: "skip" };
    }
    case "FAVORITE_RESTAURANT": {
      const names = asStringArray(constraint.value).map((name) => name.toLowerCase());
      if (names.some((name) => candidate.name.toLowerCase().includes(name))) {
        return { kind: "bonus", points: 20 };
      }
      return { kind: "skip" };
    }
    default:
      return { kind: "skip" };
  }
}

export function constraintRejectsOnFail(constraint: CouncilConstraint): boolean {
  return constraint.priority === "HARD" || constraint.priority === "HIGH";
}
