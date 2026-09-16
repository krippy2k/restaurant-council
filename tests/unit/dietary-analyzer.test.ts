import { dietaryConstraintOutcome, parseDietaryConstraints } from "@rc/protocol";
import { describe, expect, it } from "vitest";
import {
  CachingDietaryAnalyzer,
  MemoryDietaryCache,
  MockDietaryAnalyzer,
  assessDietaryEvidence,
  extractDietarySignals,
  makeEvidence,
  structuredEvidenceForRequirement
} from "@rc/tools";
import type { Restaurant } from "@rc/tools";

function restaurant(id: string, extra: Partial<Restaurant> = {}): Restaurant {
  return {
    id,
    provider: "mock",
    providerId: id,
    name: id,
    location: { latitude: 40.758, longitude: -73.9855 },
    cuisines: [],
    ...extra
  };
}

describe("dietary evidence rules", () => {
  it("treats missing evidence as uncertain, not unsupported", () => {
    const assessment = assessDietaryEvidence({
      restaurantId: "res_none",
      requirement: "dairy-free",
      evidence: []
    });
    expect(assessment.status).toBe("uncertain");
  });

  it("does not treat dish names as dairy-free proof", () => {
    expect(extractDietarySignals("The grilled salmon with vegetables was excellent.", "dairy-free")).toEqual([]);
  });

  it("maps structured vegetarian attributes without inventing dairy-free", () => {
    const veg = restaurant("res_veg", {
      attributes: { vegetarian: true },
      cuisines: ["vegetarian"]
    });
    expect(structuredEvidenceForRequirement(veg, "vegetarian").length).toBeGreaterThan(0);
    expect(structuredEvidenceForRequirement(veg, "dairy-free")).toEqual([]);
  });

  it("marks official vs review disagreement as conflicting", () => {
    const assessment = assessDietaryEvidence({
      restaurantId: "res_x",
      requirement: "gluten-free",
      evidence: [
        makeEvidence({
          sourceType: "official-allergen-info",
          excerpt: "We cannot accommodate gluten-free preparation.",
          supports: "contradicts",
          reliability: "high",
          scope: "location"
        }),
        makeEvidence({
          sourceType: "review",
          excerpt: "They made my meal gluten free.",
          supports: "supports",
          reliability: "low",
          scope: "location"
        })
      ]
    });
    expect(assessment.status).toBe("conflicting");
  });

  it("uses vegan labels for dairy-free availability but not strict safety", () => {
    const veganEvidence = [
      makeEvidence({
        sourceType: "official-menu",
        excerpt: "Vegan dishes are marked on the menu.",
        supports: "supports",
        reliability: "high",
        scope: "location"
      })
    ];
    const normal = assessDietaryEvidence({
      restaurantId: "res_v",
      requirement: "dairy-free",
      evidence: veganEvidence,
      evidenceRequirement: "normal"
    });
    const strict = assessDietaryEvidence({
      restaurantId: "res_v",
      requirement: "dairy-free",
      evidence: veganEvidence,
      evidenceRequirement: "strict"
    });
    expect(normal.status).toBe("likely");
    expect(strict.status).toBe("uncertain");
  });

  it("treats phone human verification as confirmed, not a permanent flag", () => {
    const assessment = assessDietaryEvidence({
      restaurantId: "res_human",
      requirement: "dairy-free",
      evidence: [
        makeEvidence({
          sourceType: "human-verification",
          sourceName: "Participant verification",
          observedAt: "2026-09-16T15:04:00.000Z",
          excerpt: "They said several entrees can be prepared without butter or dairy.",
          supports: "supports",
          reliability: "high",
          scope: "location"
        })
      ]
    });
    expect(assessment.status).toBe("confirmed");
    expect(assessment.evidence[0]?.observedAt).toBe("2026-09-16T15:04:00.000Z");
  });
});

describe("mock dietary analyzer fixtures", () => {
  const analyzer = new MockDietaryAnalyzer();

  it("confirms official dairy-free menu language", async () => {
    const [assessment] = await analyzer.analyze(restaurant("res_greenleaf"), {
      requirements: ["dairy-free"]
    });
    expect(assessment.status).toBe("confirmed");
    expect(assessment.evidence.length).toBeGreaterThan(0);
  });

  it("keeps vegan-only restaurants likely, not confirmed-strict", async () => {
    const [normal] = await analyzer.analyze(restaurant("res_vegan_only"), {
      requirements: ["dairy-free"],
      evidenceRequirement: "normal"
    });
    const [strict] = await analyzer.analyze(restaurant("res_vegan_only"), {
      requirements: ["dairy-free"],
      evidenceRequirement: "strict"
    });
    expect(normal.status).toBe("likely");
    expect(strict.status).toBe("uncertain");
  });

  it("uses several recent reviews as likely for normal evidence", async () => {
    const [assessment] = await analyzer.analyze(restaurant("res_reviews_df"), {
      requirements: ["dairy-free"]
    });
    expect(assessment.status).toBe("likely");
  });

  it("keeps a single old review uncertain", async () => {
    const [assessment] = await analyzer.analyze(restaurant("res_old_review"), {
      requirements: ["dairy-free"]
    });
    expect(assessment.status).toBe("uncertain");
  });

  it("returns uncertain when nothing dietary is published", async () => {
    const [assessment] = await analyzer.analyze(restaurant("res_none"), {
      requirements: ["dairy-free"]
    });
    expect(assessment.status).toBe("uncertain");
  });

  it("surfaces official vs review conflict", async () => {
    const [assessment] = await analyzer.analyze(restaurant("res_conflict"), {
      requirements: ["gluten-free"]
    });
    expect(assessment.status).toBe("conflicting");
  });

  it("does not treat chain-only allergen pages as confirmed when strict", async () => {
    const [normal] = await analyzer.analyze(restaurant("res_chain"), {
      requirements: ["dairy-free"],
      evidenceRequirement: "normal"
    });
    const [strict] = await analyzer.analyze(restaurant("res_chain"), {
      requirements: ["dairy-free"],
      evidenceRequirement: "strict"
    });
    expect(normal.status).toBe("confirmed");
    expect(strict.status).toBe("likely");
  });

  it("confirms location-specific allergen pages even when strict", async () => {
    const [assessment] = await analyzer.analyze(restaurant("res_location"), {
      requirements: ["dairy-free"],
      evidenceRequirement: "strict"
    });
    expect(assessment.status).toBe("confirmed");
  });
});

describe("dietary cache", () => {
  it("reuses fresh assessments by restaurant, requirement, and mode", async () => {
    const cache = new MemoryDietaryCache();
    const analyzer = new CachingDietaryAnalyzer(new MockDietaryAnalyzer(), cache);
    const first = await analyzer.analyze(restaurant("res_greenleaf"), {
      requirements: ["dairy-free"],
      evidenceRequirement: "normal"
    });
    const second = await analyzer.analyze(restaurant("res_greenleaf"), {
      requirements: ["dairy-free"],
      evidenceRequirement: "normal"
    });
    expect(second[0]?.analyzedAt).toBe(first[0]?.analyzedAt);
    expect(analyzer.metrics.dietary_analysis_cache_hits).toBe(1);
  });

  it("does not reuse expired assessments", async () => {
    const cache = new MemoryDietaryCache();
    await cache.set(
      {
        restaurantId: "res_greenleaf",
        requirement: "dairy-free",
        status: "confirmed",
        confidence: 0.9,
        evidence: [],
        analyzedAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-02T00:00:00.000Z"
      },
      "normal"
    );
    const analyzer = new CachingDietaryAnalyzer(new MockDietaryAnalyzer(), cache);
    const [fresh] = await analyzer.analyze(restaurant("res_greenleaf"), {
      requirements: ["dairy-free"]
    });
    expect(fresh.analyzedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(analyzer.metrics.dietary_analysis_cache_misses).toBe(1);
  });
});

describe("dietary constraint outcomes", () => {
  it("does not fail a required constraint when evidence is missing", () => {
    const constraint = parseDietaryConstraints("dairy-free")[0]!;
    expect(dietaryConstraintOutcome(constraint, undefined)).toBe("skip");
  });

  it("fails only on unsupported required constraints", () => {
    const constraint = parseDietaryConstraints({
      requirement: "dairy-free",
      strength: "required"
    })[0]!;
    expect(
      dietaryConstraintOutcome(constraint, {
        restaurantId: "res_x",
        requirement: "dairy-free",
        status: "unsupported",
        confidence: 0.8,
        evidence: [],
        analyzedAt: "2026-09-16T00:00:00.000Z"
      })
    ).toBe("fail");
  });
});
