import { formatRestaurantPrice, type RestaurantView } from "./restaurant-display";

export interface RejectionReasonView {
  participantId: string;
  constraintType: string;
  priority: string;
  required: unknown;
  actual: unknown;
  summary: string;
}

const TYPE_LABELS: Record<string, string> = {
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

function dietaryActualLabel(requirement: string, status: string): string {
  if (status === "confirmed") return `${requirement} options confirmed`;
  if (status === "likely") return `${requirement} options likely`;
  if (status === "unsupported") return `${requirement} not supported`;
  if (status === "conflicting") return `conflicting ${requirement} information`;
  return `${requirement} not verified`;
}

function dietaryStatusFromActual(actual: unknown): string | undefined {
  if (Array.isArray(actual)) {
    const statuses = actual.map((item) => {
      if (item && typeof item === "object" && "status" in (item as object)) {
        return String((item as { status: string }).status);
      }
      if (typeof item === "string" && item.includes(": ")) return item.split(": ").slice(1).join(": ");
      return undefined;
    });
    if (statuses.includes("unsupported")) return "unsupported";
    if (statuses.includes("conflicting")) return "conflicting";
    return statuses.find(Boolean);
  }
  if (actual && typeof actual === "object" && "status" in (actual as object)) {
    return String((actual as { status: string }).status);
  }
  return undefined;
}

export function dietaryReasonIsHardFail(actual: unknown, restaurant?: RestaurantView): boolean {
  const fromActual = dietaryStatusFromActual(actual);
  if (fromActual) return fromActual === "unsupported";
  return (restaurant?.dietaryAssessments ?? []).some((item) => item.status === "unsupported");
}

export function presentRejectionReasons(
  reasons: RejectionReasonView[],
  restaurant: RestaurantView
): RejectionReasonView[] {
  return reasons
    .filter((reason) => {
      if (reason.constraintType !== "DIETARY" && reason.constraintType !== "ALLERGY") return true;
      return dietaryReasonIsHardFail(reason.actual, restaurant);
    })
    .map((reason) => {
      const requiredLabel = formatReasonValue(reason.constraintType, reason.required);
      const actualLabel = formatReasonValue(reason.constraintType, reason.actual);
      const summary =
        reason.constraintType === "DIETARY"
          ? `Required ${requiredLabel}, but published information does not support it`
          : `${TYPE_LABELS[reason.constraintType] ?? reason.constraintType} is ${requiredLabel}; this restaurant is ${actualLabel}`;
      return { ...reason, summary };
    });
}

export function derivePublicRejectionReasons(input: {
  restaurant: RestaurantView;
  constraints: Array<{
    participantId: string;
    type: string;
    value: unknown;
    priority: string;
    visibility?: string;
  }>;
  evaluations: Array<{
    participantId: string;
    rejected: boolean;
    privateConflict?: boolean;
  }>;
}): RejectionReasonView[] {
  const rejecting = new Set(
    input.evaluations
      .filter((evaluation) => evaluation.rejected && evaluation.privateConflict !== true)
      .map((evaluation) => evaluation.participantId)
  );
  if (rejecting.size === 0) return [];
  const publicConstraints = input.constraints.filter(
    (constraint) => (constraint.visibility ?? "PUBLIC") === "PUBLIC"
  );
  const owned = publicConstraints.filter((constraint) => rejecting.has(constraint.participantId));
  const groupHard = publicConstraints.filter(
    (constraint) => constraint.priority === "HARD" || constraint.priority === "HIGH"
  );
  const source = owned.length ? owned : groupHard.length ? groupHard : publicConstraints;
  const hardOwned = source.filter(
    (constraint) => constraint.priority === "HARD" || constraint.priority === "HIGH"
  );
  const pool = hardOwned.length ? hardOwned : source;
  const reasons = pool
    .filter((constraint) => {
      if (constraint.type !== "DIETARY" && constraint.type !== "ALLERGY") return true;
      return (input.restaurant.dietaryAssessments ?? []).some((item) => item.status === "unsupported");
    })
    .map((constraint) => {
      const actual = actualForConstraint(constraint.type, input.restaurant);
      const requiredLabel = formatReasonValue(constraint.type, constraint.value);
      const actualLabel = formatReasonValue(constraint.type, actual);
      return {
        participantId: constraint.participantId,
        constraintType: constraint.type,
        priority: constraint.priority,
        required: constraint.value,
        actual,
        summary:
          constraint.type === "DIETARY"
            ? `Required ${requiredLabel}, but published information does not support it`
            : `${TYPE_LABELS[constraint.type] ?? constraint.type} is ${requiredLabel}; this restaurant is ${actualLabel}`
      };
    });
  return presentRejectionReasons(reasons, input.restaurant);
}

export function actualForConstraint(type: string, restaurant: RestaurantView): unknown {
  switch (type) {
    case "MAX_PRICE_LEVEL":
      return { priceLevel: restaurant.priceLevel, priceRange: restaurant.priceRange };
    case "MIN_RATING":
      return restaurant.rating;
    case "CUISINE_PREFER":
    case "CUISINE_AVOID":
      return restaurant.cuisines;
    case "DIETARY":
      return (
        restaurant.dietaryAssessments?.map((item) => ({
          requirement: item.requirement,
          status: item.status
        })) ?? restaurant.dietaryOptions ?? []
      );
    case "ACCESSIBILITY":
      return restaurant.accessibility ?? [];
    case "MAX_DISTANCE_KM":
      return restaurant.distanceKm;
    case "OUTDOOR_SEATING":
      return restaurant.outdoorSeating ?? false;
    case "AVOID_RESTAURANT":
    case "FAVORITE_RESTAURANT":
      return restaurant.name;
    default:
      return undefined;
  }
}

export function constraintTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replaceAll("_", " ").toLowerCase();
}

export function constraintPriorityLabel(priority: string): string {
  if (priority === "HARD") return "Required";
  if (priority === "HIGH") return "High priority";
  if (priority === "MEDIUM") return "Medium priority";
  if (priority === "LOW") return "Low priority";
  return priority.toLowerCase();
}

export function formatConstraintDetail(type: string, value: unknown): string {
  if (type === "OUTDOOR_SEATING") {
    if (value === true || value === "true") return "Needed";
    if (value === false || value === "false") return "Not needed";
  }
  if (type === "MAX_DISTANCE_KM" && typeof value === "number") {
    return `Within about ${Math.max(1, Math.round(value / 1.609))} miles`;
  }
  return formatReasonValue(type, value);
}

export function formatReasonValue(constraintType: string, value: unknown): string {
  if (constraintType === "MAX_PRICE_LEVEL") {
    if (typeof value === "number") {
      return formatRestaurantPrice({ priceLevel: value })?.primary ?? String(value);
    }
    if (value && typeof value === "object") {
      const record = value as {
        priceLevel?: number;
        priceRange?: RestaurantView["priceRange"];
      };
      return (
        formatRestaurantPrice({
          priceLevel: record.priceLevel,
          priceRange: record.priceRange
        })?.primary ?? "not listed"
      );
    }
  }
  if (constraintType === "MIN_RATING" && typeof value === "number") {
    return `${value.toFixed(1)}+`;
  }
  if (constraintType === "MAX_DISTANCE_KM" && typeof value === "number") {
    return `${value} km`;
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    return (
      value
        .map((item) => {
          if (item && typeof item === "object" && "requirement" in (item as object)) {
            const record = item as { requirement: string; strength?: string; status?: string };
            if (record.status) return dietaryActualLabel(record.requirement, record.status);
            return `${record.requirement}${record.strength ? ` (${record.strength})` : ""}`;
          }
          if (typeof item === "string" && item.includes(": ")) {
            const [requirement, status] = item.split(": ");
            if (requirement && status) return dietaryActualLabel(requirement, status);
          }
          return String(item);
        })
        .join(", ") || "none listed"
    );
  }
  if (value == null) return "not listed";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "status" in (value as object) && "requirement" in (value as object)) {
    const record = value as { requirement: string; status: string };
    return dietaryActualLabel(record.requirement, record.status);
  }
  return JSON.stringify(value);
}
