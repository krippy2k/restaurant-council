import type { DietaryEvidence } from "@rc/protocol";
import { clipExcerpt, makeEvidence } from "./rules.ts";

const DISH_NAME_ONLY =
  /\b(grilled salmon|salmon with vegetables|chicken (breast|plate)|steak frites|caesar salad)\b/i;

export interface ExtractedSignal {
  supports: DietaryEvidence["supports"];
  excerpt: string;
  strictCaution?: boolean;
}

export function extractDietarySignals(text: string, requirement: string): ExtractedSignal[] {
  const lower = text.toLowerCase();
  if (!lower.trim()) return [];
  if (DISH_NAME_ONLY.test(lower) && !/\b(df|gf|vegan|vegetarian|dairy-free|gluten-free)\b/i.test(lower)) {
    return [];
  }

  const signals: ExtractedSignal[] = [];
  const push = (supports: DietaryEvidence["supports"], excerpt: string, strictCaution = false) => {
    signals.push({ supports, excerpt: clipExcerpt(excerpt), strictCaution });
  };

  if (requirement === "dairy-free") {
    if (/\b(cannot|can't|unable to|no dairy[- ]free|don't have dairy[- ]free|do not have dairy[- ]free)\b/i.test(text)) {
      push("contradicts", excerptAround(text, /cannot|can't|unable|no dairy|don't have|do not have/i));
    } else if (
      /\b(df|dairy[- ]free|lactose[- ]free)\b/i.test(text) &&
      /\b(menu|options?|dishes?|substitutions?|available|marked)\b/i.test(text)
    ) {
      push("supports", excerptAround(text, /df|dairy[- ]free|lactose[- ]free/i));
    }
    if (/\bvegan\b/i.test(text) && /\b(menu|options?|dishes?|bowl|burger|available|marked)\b/i.test(text)) {
      push("supports", excerptAround(text, /vegan/i), true);
    }
    if (/\b(contains milk|made with butter|dairy allergens? present)\b/i.test(text)) {
      push("contradicts", excerptAround(text, /milk|butter|dairy allergen/i));
    }
  }

  if (requirement === "gluten-free") {
    if (/\b(cannot|can't|unable to) (accommodate|offer|make) gluten/i.test(text)) {
      push("contradicts", excerptAround(text, /cannot|can't|unable/i));
    }
    if (
      /\b(gf|gluten[- ]free)\b/i.test(text) &&
      /\b(menu|options?|dishes?|available|kitchen|meal|made|accommodat)\b/i.test(text)
    ) {
      push("supports", excerptAround(text, /gf|gluten[- ]free/i));
    }
    if (/\bcross[- ]contact\b/i.test(text) || /\bshared fryer\b/i.test(text)) {
      push("contradicts", excerptAround(text, /cross[- ]contact|shared fryer/i), true);
    }
  }

  if (requirement === "vegetarian" && /\bvegetarian\b/i.test(text)) {
    push("supports", excerptAround(text, /vegetarian/i));
  }
  if (requirement === "vegan" && /\bvegan\b/i.test(text)) {
    push("supports", excerptAround(text, /vegan/i));
  }
  if (requirement === "nut-free" && /\bnut[- ]free\b/i.test(text)) {
    push("supports", excerptAround(text, /nut[- ]free/i));
  }
  if (requirement === "peanut-free" && /\bpeanut[- ]free\b/i.test(text)) {
    push("supports", excerptAround(text, /peanut[- ]free/i));
  }

  return signals;
}

function excerptAround(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  if (!match || match.index == null) return clipExcerpt(text);
  const start = Math.max(0, match.index - 60);
  return clipExcerpt(text.slice(start, start + 180));
}

export function evidenceFromText(input: {
  text: string;
  requirement: string;
  sourceType: DietaryEvidence["sourceType"];
  sourceUrl?: string;
  sourceName?: string;
  observedAt?: string;
  reliability: DietaryEvidence["reliability"];
  scope?: DietaryEvidence["scope"];
}): DietaryEvidence[] {
  return extractDietarySignals(input.text, input.requirement).map((signal) =>
    makeEvidence({
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      sourceName: input.sourceName,
      observedAt: input.observedAt,
      excerpt: signal.excerpt,
      supports: signal.supports,
      reliability: signal.strictCaution && input.reliability === "high" ? "medium" : input.reliability,
      scope: input.scope
    })
  );
}
