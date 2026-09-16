import { z } from "zod";

export const KNOWN_DIETARY_REQUIREMENTS = [
  "dairy-free",
  "gluten-free",
  "vegetarian",
  "vegan",
  "nut-free",
  "peanut-free",
  "shellfish-free",
  "egg-free",
  "soy-free",
  "halal",
  "kosher"
] as const;

export type KnownDietaryRequirement = (typeof KNOWN_DIETARY_REQUIREMENTS)[number];
export type DietaryRequirementId = string;

export const DietaryConstraintStrengthSchema = z.enum(["preferred", "required"]);
export const DietaryEvidenceRequirementSchema = z.enum(["normal", "strict"]);
export const DietaryAssessmentStatusSchema = z.enum([
  "confirmed",
  "likely",
  "uncertain",
  "unsupported",
  "conflicting"
]);
export const DietaryEvidenceSourceTypeSchema = z.enum([
  "structured-provider",
  "official-allergen-info",
  "official-menu",
  "official-website",
  "restaurant-statement",
  "menu-provider",
  "review",
  "human-verification",
  "other"
]);
export const DietaryEvidenceSupportSchema = z.enum(["supports", "contradicts", "neutral"]);
export const DietaryEvidenceReliabilitySchema = z.enum(["high", "medium", "low"]);
export const DietaryEvidenceScopeSchema = z.enum(["location", "chain", "unknown"]);

export const DietaryConstraintSchema = z.object({
  requirement: z.string().min(1).max(40),
  strength: DietaryConstraintStrengthSchema,
  evidenceRequirement: DietaryEvidenceRequirementSchema.optional()
});

export type DietaryConstraintStrength = z.infer<typeof DietaryConstraintStrengthSchema>;
export type DietaryEvidenceRequirement = z.infer<typeof DietaryEvidenceRequirementSchema>;
export type DietaryConstraint = z.infer<typeof DietaryConstraintSchema>;

export const DietaryEvidenceSchema = z.object({
  id: z.string(),
  sourceType: DietaryEvidenceSourceTypeSchema,
  sourceUrl: z.string().optional(),
  sourceName: z.string().optional(),
  observedAt: z.string().optional(),
  excerpt: z.string().max(280).optional(),
  supports: DietaryEvidenceSupportSchema,
  reliability: DietaryEvidenceReliabilitySchema,
  scope: DietaryEvidenceScopeSchema.optional()
});

export type DietaryEvidence = z.infer<typeof DietaryEvidenceSchema>;

export const DietaryAssessmentSchema = z.object({
  restaurantId: z.string(),
  requirement: z.string(),
  status: DietaryAssessmentStatusSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(DietaryEvidenceSchema),
  analyzedAt: z.string(),
  expiresAt: z.string().optional()
});

export type DietaryAssessment = z.infer<typeof DietaryAssessmentSchema>;
export type DietaryAssessmentStatus = z.infer<typeof DietaryAssessmentStatusSchema>;

const REQUIREMENT_ALIASES: Record<string, string> = {
  dairy: "dairy-free",
  "dairy free": "dairy-free",
  dairyfree: "dairy-free",
  "lactose-free": "dairy-free",
  "lactose free": "dairy-free",
  lactose: "dairy-free",
  milk: "dairy-free",
  gluten: "gluten-free",
  "gluten free": "gluten-free",
  glutenfree: "gluten-free",
  gf: "gluten-free",
  celiac: "gluten-free",
  veggie: "vegetarian",
  vegetarian: "vegetarian",
  vegan: "vegan",
  "nut free": "nut-free",
  nutfree: "nut-free",
  "tree-nut-free": "nut-free",
  nuts: "nut-free",
  peanut: "peanut-free",
  peanuts: "peanut-free",
  "peanut free": "peanut-free",
  shellfish: "shellfish-free",
  "shellfish free": "shellfish-free",
  egg: "egg-free",
  eggs: "egg-free",
  "egg free": "egg-free",
  soy: "soy-free",
  "soy free": "soy-free",
  halal: "halal",
  kosher: "kosher"
};

export function normalizeDietaryRequirement(value: string): DietaryRequirementId | null {
  const key = value.trim().toLowerCase().replaceAll("_", "-");
  if (!key || key.length > 40) return null;
  const mapped = REQUIREMENT_ALIASES[key] ?? key;
  if (REQUIREMENT_ALIASES[mapped]) return REQUIREMENT_ALIASES[mapped];
  if (KNOWN_DIETARY_REQUIREMENTS.includes(mapped as KnownDietaryRequirement)) return mapped;
  if (/^[a-z][a-z0-9-]{1,38}$/.test(mapped)) return mapped;
  return null;
}

function constraintFromUnknown(value: unknown): DietaryConstraint | null {
  if (typeof value === "string") {
    const requirement = normalizeDietaryRequirement(value);
    return requirement ? { requirement, strength: "required" } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const requirement = normalizeDietaryRequirement(String(record.requirement ?? record.id ?? ""));
  if (!requirement) return null;
  const strength = record.strength === "preferred" ? "preferred" : "required";
  const evidenceRequirement = record.evidenceRequirement === "strict" ? "strict" : "normal";
  return { requirement, strength, evidenceRequirement };
}

export function parseDietaryConstraints(value: unknown): DietaryConstraint[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => parseDietaryConstraints(item))
      .filter((item, index, all) => all.findIndex((other) => other.requirement === item.requirement) === index);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.restrictions) || Array.isArray(record.constraints)) {
      return parseDietaryConstraints(record.constraints ?? record.restrictions);
    }
    if (record.requirement) {
      const parsed = constraintFromUnknown(record);
      return parsed ? [parsed] : [];
    }
  }
  const parsed = constraintFromUnknown(value);
  return parsed ? [parsed] : [];
}

export function dietaryRequirementIds(value: unknown): string[] {
  return parseDietaryConstraints(value).map((item) => item.requirement);
}

export function dietaryConstraintOutcome(
  constraint: DietaryConstraint,
  assessment: DietaryAssessment | undefined
): "pass" | "fail" | "skip" | "soft" {
  const strength = constraint.strength;
  const evidenceRequirement = constraint.evidenceRequirement ?? "normal";
  if (strength === "preferred") {
    if (!assessment || assessment.status === "uncertain" || assessment.status === "conflicting") {
      return "skip";
    }
    if (assessment.status === "unsupported") return "soft";
    return "pass";
  }
  if (!assessment || assessment.status === "uncertain" || assessment.status === "conflicting") {
    return "skip";
  }
  if (assessment.status === "unsupported") return "fail";
  if (assessment.status === "likely" && evidenceRequirement === "strict") return "skip";
  return "pass";
}

export function mergeDietaryConstraints(items: DietaryConstraint[]): DietaryConstraint[] {
  const byRequirement = new Map<string, DietaryConstraint>();
  for (const item of items) {
    const existing = byRequirement.get(item.requirement);
    if (!existing) {
      byRequirement.set(item.requirement, item);
      continue;
    }
    byRequirement.set(item.requirement, {
      requirement: item.requirement,
      strength: existing.strength === "required" || item.strength === "required" ? "required" : "preferred",
      evidenceRequirement:
        existing.evidenceRequirement === "strict" || item.evidenceRequirement === "strict"
          ? "strict"
          : "normal"
    });
  }
  return [...byRequirement.values()];
}

export function allergyToDietaryConstraint(value: unknown): DietaryConstraint[] {
  const names = Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
  return names
    .map((name) => normalizeDietaryRequirement(name.endsWith("-free") ? name : `${name}-free`) ?? normalizeDietaryRequirement(name))
    .filter((item): item is string => Boolean(item))
    .map((requirement) => ({
      requirement,
      strength: "required" as const,
      evidenceRequirement: "strict" as const
    }));
}
