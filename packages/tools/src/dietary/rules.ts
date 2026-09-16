import { createId, nowIso } from "@rc/shared";
import {
  dietaryConstraintOutcome,
  type DietaryAssessment,
  type DietaryAssessmentStatus,
  type DietaryConstraint,
  type DietaryEvidence,
  type DietaryEvidenceRequirement
} from "@rc/protocol";

const SOURCE_RANK: Record<DietaryEvidence["sourceType"], number> = {
  "structured-provider": 1,
  "official-allergen-info": 2,
  "official-menu": 3,
  "official-website": 4,
  "restaurant-statement": 4,
  "human-verification": 3,
  "menu-provider": 5,
  review: 6,
  other: 7
};

export function evidenceRank(evidence: DietaryEvidence): number {
  return SOURCE_RANK[evidence.sourceType] ?? 9;
}

export function isOfficial(evidence: DietaryEvidence): boolean {
  return (
    evidence.sourceType === "official-allergen-info" ||
    evidence.sourceType === "official-menu" ||
    evidence.sourceType === "official-website" ||
    evidence.sourceType === "restaurant-statement" ||
    evidence.sourceType === "structured-provider"
  );
}

export function clipExcerpt(text: string, max = 240): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trim()}…`;
}

export function makeEvidence(
  partial: Omit<DietaryEvidence, "id"> & { id?: string }
): DietaryEvidence {
  return {
    ...partial,
    id: partial.id ?? createId("evd"),
    excerpt: partial.excerpt ? clipExcerpt(partial.excerpt) : undefined
  };
}

function recentReview(evidence: DietaryEvidence): boolean {
  if (evidence.sourceType !== "review") return false;
  if (!evidence.observedAt) return true;
  const age = Date.now() - new Date(evidence.observedAt).getTime();
  return Number.isFinite(age) && age < 1000 * 60 * 60 * 24 * 365;
}

export function assessDietaryEvidence(input: {
  restaurantId: string;
  requirement: string;
  evidence: DietaryEvidence[];
  evidenceRequirement?: DietaryEvidenceRequirement;
}): DietaryAssessment {
  const mode = input.evidenceRequirement ?? "normal";
  const evidence = [...input.evidence].sort((a, b) => evidenceRank(a) - evidenceRank(b));
  const supporting = evidence.filter((item) => item.supports === "supports");
  const contradicting = evidence.filter((item) => item.supports === "contradicts");
  const officialSupport = supporting.filter(isOfficial);
  const officialContradict = contradicting.filter(isOfficial);
  const reviewSupport = supporting.filter((item) => item.sourceType === "review");
  const highOfficial = officialSupport.filter((item) => item.reliability === "high");
  const veganOnly =
    input.requirement === "dairy-free" &&
    officialSupport.length > 0 &&
    officialSupport.every((item) => /vegan/i.test(item.excerpt ?? item.sourceName ?? ""));
  const humanSupport = supporting.filter((item) => item.sourceType === "human-verification");
  const humanContradict = contradicting.filter((item) => item.sourceType === "human-verification");

  let status: DietaryAssessmentStatus = "uncertain";
  let confidence = 0.35;

  if (humanContradict.length && !humanSupport.length) {
    status = "unsupported";
    confidence = humanContradict[0]?.reliability === "high" ? 0.82 : 0.7;
  } else if (humanSupport.length && humanContradict.length) {
    status = "conflicting";
    confidence = 0.46;
  } else if (humanSupport.some((item) => item.reliability === "high" || item.reliability === "medium")) {
    status = mode === "strict" ? "likely" : "confirmed";
    confidence = status === "confirmed" ? 0.86 : 0.7;
  } else if (evidence.length === 0) {
    status = "uncertain";
    confidence = 0.2;
  } else if (officialContradict.length && officialSupport.length) {
    status = "conflicting";
    confidence = 0.45;
  } else if (officialContradict.length && reviewSupport.length) {
    status = "conflicting";
    confidence = 0.4;
  } else if (officialContradict.length) {
    status = "unsupported";
    confidence = officialContradict[0]?.reliability === "high" ? 0.86 : 0.7;
  } else if (contradicting.length && supporting.length) {
    status = "conflicting";
    confidence = 0.42;
  } else if (highOfficial.length && !veganOnly) {
    status = mode === "strict" && highOfficial.every((item) => item.scope === "chain") ? "likely" : "confirmed";
    confidence = status === "confirmed" ? 0.92 : 0.72;
  } else if (officialSupport.length && veganOnly) {
    status = mode === "strict" ? "uncertain" : "likely";
    confidence = mode === "strict" ? 0.48 : 0.7;
  } else if (officialSupport.length) {
    status = mode === "strict" ? "likely" : "confirmed";
    confidence = mode === "strict" ? 0.68 : 0.84;
  } else if (reviewSupport.length >= 2 && reviewSupport.filter(recentReview).length >= 2) {
    status = mode === "strict" ? "uncertain" : "likely";
    confidence = mode === "strict" ? 0.4 : 0.62;
  } else if (reviewSupport.length === 1) {
    status = "uncertain";
    confidence = 0.38;
  } else if (supporting.length) {
    status = "uncertain";
    confidence = 0.4;
  }

  const ttlHours = mode === "strict" ? 48 : 24 * 7;
  const analyzedAt = nowIso();
  return {
    restaurantId: input.restaurantId,
    requirement: input.requirement,
    status,
    confidence,
    evidence,
    analyzedAt,
    expiresAt: new Date(Date.parse(analyzedAt) + ttlHours * 3600 * 1000).toISOString()
  };
}

export function assessmentSatisfies(
  assessment: DietaryAssessment | undefined,
  strength: DietaryConstraint["strength"],
  evidenceRequirement: DietaryEvidenceRequirement = "normal"
): "pass" | "fail" | "skip" | "soft" {
  return dietaryConstraintOutcome(
    { requirement: assessment?.requirement ?? "unknown", strength, evidenceRequirement },
    assessment
  );
}

export function uncertainAssessment(restaurantId: string, requirement: string): DietaryAssessment {
  const analyzedAt = nowIso();
  return {
    restaurantId,
    requirement,
    status: "uncertain",
    confidence: 0.2,
    evidence: [],
    analyzedAt,
    expiresAt: new Date(Date.parse(analyzedAt) + 24 * 3600 * 1000).toISOString()
  };
}
