import {
  ConstraintTypeSchema,
  EvaluationReasonCodeSchema,
  MatchLabelSchema,
  PrioritySchema
} from "@rc/protocol";
import { z } from "zod";

export const ConstraintDraftSchema = z.object({
  type: ConstraintTypeSchema,
  value: z.unknown(),
  priority: PrioritySchema.default("MEDIUM")
});

function positiveKm(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const match = value.match(/(\d+(?:\.\d+)?)\s*km/i);
    if (match) return Number(match[1]);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["maxKm", "km", "radiusKm", "distanceKm"]) {
      const n = Number(record[key]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

function coerceModelDraft(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const draft = item as Record<string, unknown>;
  const type =
    typeof draft.type === "string"
      ? draft.type.trim().toUpperCase().replace(/[\s-]+/g, "_")
      : draft.type;
  if (
    type === "LOCATION" ||
    type === "DISTANCE" ||
    type === "NEARBY" ||
    type === "MAX_DISTANCE"
  ) {
    const km = positiveKm(draft.value);
    if (km == null) return null;
    return { ...draft, type: "MAX_DISTANCE_KM", value: km };
  }
  return { ...draft, type };
}

export function keepValidConstraintDrafts(items: unknown): ConstraintDraft[] {
  if (!Array.isArray(items)) return [];
  const drafts: ConstraintDraft[] = [];
  for (const item of items) {
    const parsed = ConstraintDraftSchema.safeParse(coerceModelDraft(item));
    if (parsed.success) drafts.push(parsed.data);
  }
  return drafts;
}

export type ConstraintDraft = z.infer<typeof ConstraintDraftSchema>;

export const DerivedConstraintsLlmSchema = z.object({
  publicConstraints: z.preprocess(
    (value) => keepValidConstraintDrafts(value ?? []),
    z.array(ConstraintDraftSchema)
  ),
  privateConstraints: z.preprocess(
    (value) => keepValidConstraintDrafts(value ?? []),
    z.array(ConstraintDraftSchema)
  )
}) as z.ZodType<{
  publicConstraints: ConstraintDraft[];
  privateConstraints: ConstraintDraft[];
}>;

export const EvaluationDraftSchema = z.object({
  candidateId: z.string(),
  score: z.number().min(0).max(100),
  label: MatchLabelSchema,
  reasonCode: EvaluationReasonCodeSchema,
  rejected: z.boolean(),
  privateConflict: z.boolean()
});

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

function asScore(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, n));
}

function normalizeEvaluationScore(
  score: number,
  label: z.infer<typeof MatchLabelSchema>,
  rejected: boolean
): number {
  let n = score;
  const positive =
    !rejected && label !== "Weak match" && label !== "Constraint conflict";
  if (positive && n > 0 && n <= 1) n *= 100;
  else if (positive && n <= 5) n = (n / 5) * 100;
  else if (positive && n <= 10) n = (n / 10) * 100;
  n = Math.round(Math.max(0, Math.min(100, n)));
  if (rejected) return n;
  if (label === "Strong match" && n < 85) return 85;
  if (label === "Good match" && n < 70) return 70;
  if (label === "Acceptable" && n < 55) return 55;
  return n;
}

function asFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const key = normalizeKey(value);
  if (["TRUE", "YES", "1", "REJECTED", "REJECT"].includes(key)) return true;
  if (["FALSE", "NO", "0"].includes(key)) return false;
  return undefined;
}

function labelFromScore(score: number, rejected: boolean): z.infer<typeof MatchLabelSchema> {
  if (rejected) return "Constraint conflict";
  if (score >= 85) return "Strong match";
  if (score >= 70) return "Good match";
  if (score >= 55) return "Acceptable";
  return "Weak match";
}

const LABEL_ALIASES: Record<string, z.infer<typeof MatchLabelSchema>> = {
  STRONG: "Strong match",
  STRONG_MATCH: "Strong match",
  GOOD: "Good match",
  GOOD_MATCH: "Good match",
  ACCEPTABLE: "Acceptable",
  OK: "Acceptable",
  OKAY: "Acceptable",
  WEAK: "Weak match",
  WEAK_MATCH: "Weak match",
  CONSTRAINT_CONFLICT: "Constraint conflict",
  CONFLICT: "Constraint conflict",
  REJECTED: "Constraint conflict",
  REJECT: "Constraint conflict",
  FAIL: "Constraint conflict",
  FAILED: "Constraint conflict"
};

function coerceLabel(
  raw: unknown,
  score: number,
  rejected: boolean
): z.infer<typeof MatchLabelSchema> {
  const exact = MatchLabelSchema.safeParse(raw);
  if (exact.success) return exact.data;
  return LABEL_ALIASES[normalizeKey(raw)] ?? labelFromScore(score, rejected);
}

function coerceReason(
  raw: unknown,
  score: number,
  rejected: boolean,
  privateConflict: boolean
): z.infer<typeof EvaluationReasonCodeSchema> {
  const exact = EvaluationReasonCodeSchema.safeParse(raw);
  if (exact.success) return exact.data;
  const key = normalizeKey(raw);
  if (key.includes("PRIVATE")) return "PRIVATE_CONSTRAINT_CONFLICT";
  if (key.includes("HARD")) return "HARD_CONSTRAINT_CONFLICT";
  if (rejected || key.includes("CONFLICT") || key === "REJECTED") {
    return privateConflict ? "PRIVATE_CONSTRAINT_CONFLICT" : "PUBLIC_CONSTRAINT_CONFLICT";
  }
  if (score < 55) return "WEAK_MATCH";
  return "MATCH";
}

export function keepValidEvaluations(items: unknown): z.infer<typeof EvaluationDraftSchema>[] {
  if (!Array.isArray(items)) return [];
  const evaluations: z.infer<typeof EvaluationDraftSchema>[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const candidateId =
      typeof record.candidateId === "string"
        ? record.candidateId
        : typeof record.id === "string"
          ? record.id
          : undefined;
    const score = asScore(record.score);
    if (!candidateId || score == null) continue;
    const privateConflict = asFlag(record.privateConflict) ?? false;
    let rejected = asFlag(record.rejected) ?? false;
    const label = coerceLabel(record.label, score, rejected);
    if (label === "Constraint conflict") rejected = true;
    const normalizedScore = normalizeEvaluationScore(score, label, rejected);
    const reasonCode = coerceReason(record.reasonCode, normalizedScore, rejected, privateConflict);
    const parsed = EvaluationDraftSchema.safeParse({
      candidateId,
      score: normalizedScore,
      label: rejected ? "Constraint conflict" : labelFromScore(normalizedScore, rejected),
      reasonCode:
        rejected && privateConflict ? "PRIVATE_CONSTRAINT_CONFLICT" : reasonCode,
      rejected,
      privateConflict: privateConflict || reasonCode === "PRIVATE_CONSTRAINT_CONFLICT"
    });
    if (parsed.success) evaluations.push(parsed.data);
  }
  return evaluations;
}

export const EvaluationsLlmSchema = z.object({
  evaluations: z.preprocess(
    (value) => keepValidEvaluations(value ?? []),
    z.array(EvaluationDraftSchema)
  )
}) as z.ZodType<{
  evaluations: z.infer<typeof EvaluationDraftSchema>[];
}>;

const NegotiationPickSchema = z.object({
  candidateId: z.string(),
  explanations: z.array(z.string().max(180)).max(5).default([])
});

function keepValidPicks(items: unknown): z.infer<typeof NegotiationPickSchema>[] {
  if (!Array.isArray(items)) return [];
  const picks: z.infer<typeof NegotiationPickSchema>[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const explanations = Array.isArray(record.explanations)
      ? record.explanations
      : typeof record.explanations === "string"
        ? [record.explanations]
        : [];
    const parsed = NegotiationPickSchema.safeParse({
      candidateId: record.candidateId ?? record.id,
      explanations
    });
    if (parsed.success) picks.push(parsed.data);
  }
  return picks.slice(0, 3);
}

export const NegotiationLlmSchema = z.object({
  picks: z.preprocess(
    (value) => keepValidPicks(value ?? []),
    z.array(NegotiationPickSchema).max(3)
  )
}) as z.ZodType<{
  picks: z.infer<typeof NegotiationPickSchema>[];
}>;
