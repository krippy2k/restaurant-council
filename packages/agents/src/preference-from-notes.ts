import {
  secrecyLanguageSpans,
  textRequestsSecrecy,
  type PreferenceCategory,
  type PreferencePriority,
  type PreferenceVisibility
} from "@rc/domain";
import { parseDietaryConstraints, type DietaryConstraint } from "@rc/protocol";
import type { AgentRuntime } from "./runtime.ts";
import { parseFreeform } from "./personal-agent.ts";
import { DerivedConstraintsLlmSchema, type ConstraintDraft } from "./schemas.ts";

export interface PreferenceNoteDraft {
  category: PreferenceCategory;
  visibility: PreferenceVisibility;
  priority: PreferencePriority;
  value: Record<string, unknown>;
  sourceText?: string;
  summary: string;
}

const NOTE_SYSTEM = `You extract restaurant preferences from one participant's notes.
Return JSON: {"publicConstraints":[],"privateConstraints":[]}.
Allowed types: MAX_PRICE_LEVEL, MIN_RATING, CUISINE_PREFER, CUISINE_AVOID, DIETARY, ACCESSIBILITY, MAX_DISTANCE_KM, ATMOSPHERE, OUTDOOR_SEATING, AVOID_RESTAURANT, FAVORITE_RESTAURANT.
MAX_PRICE_LEVEL is 1-4. DIETARY value is [{requirement,strength,evidenceRequirement}] with known ids: dairy-free, gluten-free, vegetarian, vegan, nut-free, peanut-free, shellfish-free, egg-free, soy-free, halal, kosher.
strength is preferred or required. evidenceRequirement is normal or strict.
If notes ask to keep it quiet, not to tell the group, keep this private, or similar, put only the constraint immediately before that request in privateConstraints. Constraints mentioned after the request follow requestedVisibility. Do not list the same constraint twice.
Do not copy the original story, diagnosis, or finances into values.
Each constraint: {"type":"...","value":...,"priority":"LOW"|"MEDIUM"|"HIGH"|"HARD"}`;

function priceSummary(level: number): string {
  if (level <= 1) return "Under about $15";
  if (level <= 2) return "Under about $30";
  if (level <= 3) return "Up to $$$";
  return "$$$$ is fine";
}

function dietaryList(value: unknown): DietaryConstraint[] {
  return parseDietaryConstraints(value);
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function preferenceFromConstraint(
  draft: ConstraintDraft,
  visibility: PreferenceVisibility,
  sourceText: string
): PreferenceNoteDraft | undefined {
  const source = visibility === "PRIVATE" ? sourceText : undefined;
  switch (draft.type) {
    case "MAX_PRICE_LEVEL": {
      const level = Math.max(1, Math.min(4, Math.round(Number(draft.value))));
      if (!Number.isFinite(level)) return undefined;
      return {
        category: "price",
        visibility,
        priority: draft.priority,
        value: { maxPriceLevel: level },
        sourceText: source,
        summary: priceSummary(level)
      };
    }
    case "CUISINE_PREFER": {
      const cuisines = asStringArray(draft.value);
      if (!cuisines.length) return undefined;
      return {
        category: "cuisine",
        visibility,
        priority: draft.priority,
        value: { cuisines },
        sourceText: source,
        summary: `Prefers ${cuisines.join(", ")}`
      };
    }
    case "CUISINE_AVOID": {
      const avoid = asStringArray(draft.value);
      if (!avoid.length) return undefined;
      return {
        category: "cuisine",
        visibility,
        priority: draft.priority,
        value: { avoid },
        sourceText: source,
        summary: `Avoids ${avoid.join(", ")}`
      };
    }
    case "DIETARY": {
      const constraints = dietaryList(draft.value);
      if (!constraints.length) return undefined;
      return {
        category: "dietary",
        visibility,
        priority: draft.priority,
        value: {
          restrictions: constraints.map((item) => item.requirement),
          constraints
        },
        sourceText: source,
        summary: constraints
          .map((item) => `${item.requirement.replaceAll("-", " ")} (${item.strength})`)
          .join(", ")
      };
    }
    case "ACCESSIBILITY": {
      const needs = asStringArray(draft.value);
      if (!needs.length) return undefined;
      return {
        category: "accessibility",
        visibility,
        priority: draft.priority,
        value: { needs },
        sourceText: source,
        summary: `Accessibility: ${needs.join(", ")}`
      };
    }
    case "MAX_DISTANCE_KM": {
      const maxKm = Number(draft.value);
      if (!Number.isFinite(maxKm) || maxKm <= 0) return undefined;
      return {
        category: "distance",
        visibility,
        priority: draft.priority,
        value: { maxKm },
        sourceText: source,
        summary: `Within about ${Math.round(maxKm / 1.609)} miles`
      };
    }
    case "ATMOSPHERE": {
      const tags = asStringArray(draft.value);
      if (!tags.length) return undefined;
      return {
        category: "atmosphere",
        visibility,
        priority: draft.priority,
        value: { tags },
        sourceText: source,
        summary: tags.join(", ")
      };
    }
    case "OUTDOOR_SEATING":
      return {
        category: "seating",
        visibility,
        priority: draft.priority,
        value: { outdoor: draft.value === true || draft.value === "true" },
        sourceText: source,
        summary: draft.value === false ? "No outdoor seating needed" : "Outdoor seating"
      };
    case "AVOID_RESTAURANT": {
      const names = asStringArray(draft.value);
      if (!names.length) return undefined;
      return {
        category: "dislikes",
        visibility,
        priority: draft.priority,
        value: { names },
        sourceText: source,
        summary: `Skip ${names.join(", ")}`
      };
    }
    case "FAVORITE_RESTAURANT": {
      const names = asStringArray(draft.value);
      if (!names.length) return undefined;
      return {
        category: "favorites",
        visibility,
        priority: draft.priority,
        value: { names },
        sourceText: source,
        summary: `Likes ${names.join(", ")}`
      };
    }
    default:
      return undefined;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstMatchIndex(text: string, patterns: RegExp[]): number {
  const lower = text.toLowerCase();
  let best = Number.POSITIVE_INFINITY;
  for (const pattern of patterns) {
    const match = pattern.exec(lower);
    if (match) best = Math.min(best, match.index);
  }
  return best;
}

function mentionIndex(text: string, draft: ConstraintDraft): number {
  switch (draft.type) {
    case "MAX_PRICE_LEVEL":
      return firstMatchIndex(text, [/under\s*\$?\s*\d+/, /money is tight/, /\bbudget\b/, /\$\s*\d+/]);
    case "CUISINE_PREFER":
    case "CUISINE_AVOID":
      return firstMatchIndex(
        text,
        asStringArray(draft.value).map((name) => new RegExp(`\\b${escapeRegex(name)}\\b`, "i"))
      );
    case "DIETARY": {
      const patterns: RegExp[] = [];
      for (const item of dietaryList(draft.value)) {
        if (item.requirement === "dairy-free") patterns.push(/\bdairy[- ]free\b/, /\blactose\b/, /\bdairy\b/);
        else if (item.requirement === "gluten-free") {
          patterns.push(/\bgluten[- ]free\b/, /\bgluten\b/, /\bceliac\b/);
        } else {
          patterns.push(new RegExp(`\\b${escapeRegex(item.requirement).replaceAll("-", "[- ]")}\\b`, "i"));
        }
      }
      return firstMatchIndex(text, patterns);
    }
    case "ACCESSIBILITY":
      return firstMatchIndex(text, [/\baccessib/, /\bwheelchair\b/, /\bramp\b/]);
    case "MAX_DISTANCE_KM":
      return firstMatchIndex(text, [/\bmiles?\b/, /\bkm\b/, /\bwithin\b/]);
    case "ATMOSPHERE":
      return firstMatchIndex(
        text,
        asStringArray(draft.value).map((tag) => new RegExp(`\\b${escapeRegex(tag)}\\b`, "i"))
      );
    case "OUTDOOR_SEATING":
      return firstMatchIndex(text, [/\boutdoor\b/]);
    case "AVOID_RESTAURANT":
    case "FAVORITE_RESTAURANT":
      return firstMatchIndex(
        text,
        asStringArray(draft.value).map((name) => new RegExp(escapeRegex(name), "i"))
      );
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function explodeDrafts(drafts: ConstraintDraft[]): ConstraintDraft[] {
  const exploded: ConstraintDraft[] = [];
  for (const draft of drafts) {
    if (draft.type !== "DIETARY") {
      exploded.push(draft);
      continue;
    }
    for (const item of dietaryList(draft.value)) {
      exploded.push({ ...draft, value: [item] });
    }
  }
  return exploded;
}

function draftKey(draft: ConstraintDraft): string {
  if (draft.type === "DIETARY") {
    return `DIETARY:${dietaryList(draft.value)
      .map((item) => item.requirement)
      .sort()
      .join(",")}`;
  }
  if (draft.type === "MAX_PRICE_LEVEL") {
    return `MAX_PRICE_LEVEL:${Math.round(Number(draft.value))}`;
  }
  return `${draft.type}:${JSON.stringify(draft.value)}`;
}

function draftRank(draft: ConstraintDraft): number {
  if (draft.type !== "DIETARY") return 0;
  return dietaryList(draft.value).reduce((score, item) => {
    return score + (item.strength === "required" ? 2 : 1) + (item.evidenceRequirement === "strict" ? 2 : 0);
  }, 0);
}

function uniqueDrafts(drafts: ConstraintDraft[]): ConstraintDraft[] {
  const exploded = explodeDrafts(drafts).filter((draft) => preferenceFromConstraint(draft, "PUBLIC", "x"));
  const best = new Map<string, ConstraintDraft>();
  for (const draft of exploded) {
    const key = draftKey(draft);
    const existing = best.get(key);
    if (!existing || draftRank(draft) > draftRank(existing)) best.set(key, draft);
  }
  const seen = new Set<string>();
  const unique: ConstraintDraft[] = [];
  for (const draft of exploded) {
    const key = draftKey(draft);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(best.get(key) ?? draft);
  }
  return unique;
}

function inMentionOrder(text: string, drafts: ConstraintDraft[]): { draft: ConstraintDraft; at: number }[] {
  return drafts
    .map((draft, index) => ({ draft, index, at: mentionIndex(text, draft) }))
    .sort((left, right) => {
      const leftAt = Number.isFinite(left.at) ? left.at : Number.POSITIVE_INFINITY;
      const rightAt = Number.isFinite(right.at) ? right.at : Number.POSITIVE_INFINITY;
      if (leftAt !== rightAt) return leftAt - rightAt;
      return left.index - right.index;
    });
}

function privateIndexesFromSecrecy(text: string, ordered: { draft: ConstraintDraft; at: number }[]): Set<number> {
  const privateIndexes = new Set<number>();
  for (const span of secrecyLanguageSpans(text)) {
    let before = -1;
    for (let index = 0; index < ordered.length; index += 1) {
      const at = ordered[index]?.at ?? Number.POSITIVE_INFINITY;
      if (Number.isFinite(at) && at < span.index) before = index;
    }
    if (before >= 0) {
      privateIndexes.add(before);
      continue;
    }
    const after = ordered.findIndex((item) => Number.isFinite(item.at) && item.at >= span.end);
    if (after >= 0) privateIndexes.add(after);
  }
  return privateIndexes;
}

function freeformDraft(text: string, visibility: PreferenceVisibility): PreferenceNoteDraft {
  return {
    category: "freeform",
    visibility,
    priority: "MEDIUM",
    value: { text },
    sourceText: visibility === "PRIVATE" ? text : undefined,
    summary: text.length > 80 ? `${text.slice(0, 77)}…` : text
  };
}

async function constraintsFromNotes(
  text: string,
  requestedVisibility: PreferenceVisibility,
  runtime?: AgentRuntime
): Promise<{ publicDrafts: ConstraintDraft[]; privateDrafts: ConstraintDraft[] }> {
  const parsed = parseFreeform(text);
  if (!runtime) {
    if (requestedVisibility === "PRIVATE") return { publicDrafts: [], privateDrafts: parsed };
    return { publicDrafts: parsed, privateDrafts: [] };
  }
  try {
    const result = await runtime.completeStructured({
      system: NOTE_SYSTEM,
      user: JSON.stringify({
        notes: text,
        requestedVisibility
      }),
      schema: DerivedConstraintsLlmSchema
    });
    return {
      publicDrafts: result.publicConstraints ?? [],
      privateDrafts: result.privateConstraints ?? []
    };
  } catch {
    if (requestedVisibility === "PRIVATE") return { publicDrafts: [], privateDrafts: parsed };
    return { publicDrafts: parsed, privateDrafts: [] };
  }
}

export async function interpretPreferenceNotes(input: {
  text: string;
  requestedVisibility?: PreferenceVisibility;
  runtime?: AgentRuntime;
}): Promise<PreferenceNoteDraft[]> {
  const text = input.text.trim();
  if (!text) return [];
  const requested = input.requestedVisibility ?? "PRIVATE";
  const quiet = textRequestsSecrecy(text);
  const { publicDrafts, privateDrafts } = await constraintsFromNotes(text, requested, input.runtime);
  const unique = uniqueDrafts([...publicDrafts, ...privateDrafts]);
  const ordered = inMentionOrder(text, unique);
  const privateIndexes =
    requested === "PRIVATE" ? new Set(ordered.map((_, index) => index)) : privateIndexesFromSecrecy(text, ordered);
  const drafts = ordered.flatMap(({ draft }, index) => {
    const visibility: PreferenceVisibility = privateIndexes.has(index) ? "PRIVATE" : requested;
    const item = preferenceFromConstraint(draft, visibility, text);
    return item ? [item] : [];
  });
  if (!drafts.length) {
    return [freeformDraft(text, requested === "PRIVATE" || quiet ? "PRIVATE" : "PUBLIC")];
  }
  return drafts;
}
