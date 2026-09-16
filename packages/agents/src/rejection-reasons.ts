import type {
  CouncilConstraint,
  PublicRejectionReason,
  RestaurantCandidate
} from "@rc/protocol";
import { assessConstraint, constraintRejectsOnFail } from "./constraint-check.ts";

const TYPE_LABELS: Record<CouncilConstraint["type"], string> = {
  MAX_PRICE_LEVEL: "Max price",
  MIN_RATING: "Minimum rating",
  CUISINE_PREFER: "Preferred cuisine",
  CUISINE_AVOID: "Cuisine to avoid",
  DIETARY: "Dietary need",
  ALLERGY: "Allergy",
  ACCESSIBILITY: "Accessibility",
  MAX_DISTANCE_KM: "Maximum distance",
  ATMOSPHERE: "Atmosphere",
  OUTDOOR_SEATING: "Outdoor seating",
  AVOID_RESTAURANT: "Restaurant to avoid",
  FAVORITE_RESTAURANT: "Favorite restaurant"
};

function formatDietaryValue(item: unknown): string {
  if (item && typeof item === "object" && "requirement" in (item as object)) {
    const record = item as { requirement: string; strength?: string; status?: string };
    if (record.status) return dietaryStatusLabel(record.requirement, record.status);
    return `${record.requirement}${record.strength ? ` (${record.strength})` : ""}`;
  }
  return String(item);
}

function dietaryStatusLabel(requirement: string, status: string): string {
  if (status === "confirmed") return `${requirement} options confirmed`;
  if (status === "likely") return `${requirement} options likely`;
  if (status === "unsupported") return `${requirement} not supported`;
  if (status === "conflicting") return `conflicting ${requirement} information`;
  return `${requirement} not verified`;
}

function priceSymbols(level: number): string {
  return "$".repeat(Math.min(4, Math.max(1, Math.round(level))));
}

function formatPriceActual(actual: unknown): string {
  if (!actual || typeof actual !== "object") {
    return typeof actual === "number" ? priceSymbols(actual) : String(actual ?? "not listed");
  }
  const record = actual as {
    priceLevel?: number;
    priceRange?: { startAmount?: number; endAmount?: number };
  };
  const range = record.priceRange;
  if (range?.startAmount != null && range.endAmount != null) {
    return `$${range.startAmount}–$${range.endAmount}`;
  }
  if (range?.startAmount != null) return `$${range.startAmount}+`;
  if (record.priceLevel) return priceSymbols(record.priceLevel);
  return "not listed";
}

export function formatConstraintValue(
  type: CouncilConstraint["type"],
  value: unknown
): string {
  if (type === "MAX_PRICE_LEVEL" && typeof value === "number") return priceSymbols(value);
  if (type === "MIN_RATING" && typeof value === "number") return `${value.toFixed(1)}+`;
  if (type === "MAX_DISTANCE_KM" && typeof value === "number") return `${value} km`;
  if (type === "OUTDOOR_SEATING") return value === true ? "required" : "not required";
  if (Array.isArray(value)) {
    return value
      .map((item) => formatDietaryValue(item))
      .join(", ") || "none listed";
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value == null) return "not listed";
  if (typeof value === "object") return formatPriceActual(value);
  return String(value);
}

export function publicRejectionReasons(
  candidate: RestaurantCandidate,
  constraints: CouncilConstraint[],
  evaluations: Array<{ participantId: string; rejected: boolean; privateConflict?: boolean }> = []
): PublicRejectionReason[] {
  const rejectingPublic = new Set(
    evaluations
      .filter((evaluation) => evaluation.rejected && evaluation.privateConflict !== true)
      .map((evaluation) => evaluation.participantId)
  );
  const publicConstraints = constraints.filter((constraint) => constraint.visibility === "PUBLIC");
  let pool = publicConstraints;
  if (rejectingPublic.size > 0) {
    const owned = publicConstraints.filter((constraint) => rejectingPublic.has(constraint.participantId));
    const hardOwned = owned.filter(constraintRejectsOnFail);
    pool = hardOwned.length ? hardOwned : owned;
    if (pool.length === 0) {
      const groupHard = publicConstraints.filter(constraintRejectsOnFail);
      pool = groupHard.length ? groupHard : publicConstraints;
    }
  }

  const reasons: PublicRejectionReason[] = [];
  for (const constraint of pool) {
    const assessment = assessConstraint(constraint, candidate);
    if (assessment.kind === "pass" || assessment.kind === "bonus") continue;
    if (constraint.type === "DIETARY" && assessment.kind !== "fail") continue;
    if (rejectingPublic.size === 0 && assessment.kind !== "fail") continue;
    if (assessment.kind !== "fail" && !constraintRejectsOnFail(constraint) && rejectingPublic.size > 0) {
      continue;
    }
    const actual =
      assessment.kind === "fail" || assessment.kind === "skip" ? assessment.actual : actualFromCandidate(constraint.type, candidate);
    const requiredLabel = formatConstraintValue(constraint.type, constraint.value);
    const actualLabel = formatConstraintValue(constraint.type, actual);
    const summary =
      constraint.type === "DIETARY"
        ? `Required ${requiredLabel}, but published information does not support it`
        : `${TYPE_LABELS[constraint.type]} is ${requiredLabel}; this restaurant is ${actualLabel}`;
    reasons.push({
      participantId: constraint.participantId,
      constraintType: constraint.type,
      priority: constraint.priority,
      required: constraint.value,
      actual,
      summary
    });
  }

  if (reasons.length === 0 && rejectingPublic.size > 0) {
    for (const constraint of pool) {
      if (constraint.type === "DIETARY") continue;
      const actual = actualFromCandidate(constraint.type, candidate);
      const requiredLabel = formatConstraintValue(constraint.type, constraint.value);
      const actualLabel = formatConstraintValue(constraint.type, actual);
      reasons.push({
        participantId: constraint.participantId,
        constraintType: constraint.type,
        priority: constraint.priority,
        required: constraint.value,
        actual,
        summary: `${TYPE_LABELS[constraint.type]} is ${requiredLabel}; this restaurant is ${actualLabel}`
      });
    }
  }
  return reasons;
}

function actualFromCandidate(type: CouncilConstraint["type"], candidate: RestaurantCandidate): unknown {
  switch (type) {
    case "MAX_PRICE_LEVEL":
      return { priceLevel: candidate.priceLevel, priceRange: candidate.priceRange };
    case "MIN_RATING":
      return candidate.rating;
    case "CUISINE_PREFER":
    case "CUISINE_AVOID":
      return candidate.cuisines;
    case "DIETARY":
      return (candidate.dietaryAssessments ?? []).map((item) => `${item.requirement}: ${item.status}`);
    case "ACCESSIBILITY":
      return candidate.accessibility ?? [];
    case "MAX_DISTANCE_KM":
      return candidate.distanceKm;
    case "OUTDOOR_SEATING":
      return candidate.outdoorSeating ?? false;
    case "AVOID_RESTAURANT":
    case "FAVORITE_RESTAURANT":
      return candidate.name;
    default:
      return undefined;
  }
}
