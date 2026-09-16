import { evaluateCandidate, negotiate, publicRejectionReasons } from "@rc/agents";
import {
  createNegotiatorPrincipal,
  createPersonalAgentPrincipal
} from "@rc/auth";
import { sanitizeCouncilSnapshotForClients, type CouncilConstraint } from "@rc/protocol";
import { describe, expect, it } from "vitest";

const stk = {
  id: "rst_stk",
  name: "STK",
  priceLevel: 4 as const,
  priceRange: { startAmount: 60, currencyCode: "USD" as const },
  rating: 4.4,
  cuisines: ["steak"],
  latitude: 40.76,
  longitude: -73.98
};

describe("public rejection reasons", () => {
  it("explains a public hard price conflict with required vs actual values", () => {
    const constraints: CouncilConstraint[] = [
      {
        id: "c1",
        eventId: "evt_a",
        participantId: "usr_gee",
        type: "MAX_PRICE_LEVEL",
        value: 2,
        priority: "HARD",
        visibility: "PUBLIC"
      }
    ];
    const reasons = publicRejectionReasons(stk, constraints);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.constraintType).toBe("MAX_PRICE_LEVEL");
    expect(reasons[0]?.required).toBe(2);
    expect(reasons[0]?.actual).toMatchObject({ priceLevel: 4, priceRange: { startAmount: 60 } });
    expect(reasons[0]?.summary).toContain("$$");
    expect(reasons[0]?.summary).toContain("$60+");
  });

  it("attaches public reasons to a rejected recommendation", async () => {
    const gee = createPersonalAgentPrincipal({ userId: "usr_gee", eventId: "evt_a" });
    const constraints: CouncilConstraint[] = [
      {
        id: "c1",
        eventId: "evt_a",
        participantId: "usr_gee",
        type: "MAX_PRICE_LEVEL",
        value: 2,
        priority: "HARD",
        visibility: "PUBLIC"
      }
    ];
    const geeEval = evaluateCandidate({ principal: gee, candidate: stk, constraints });
    const recs = await negotiate({
      principal: createNegotiatorPrincipal("evt_a"),
      eventId: "evt_a",
      constraints,
      candidates: [stk],
      evaluations: [geeEval]
    });
    expect(recs[0]?.rejected).toBe(true);
    expect(recs[0]?.rejectionReasons?.[0]?.required).toBe(2);
    expect(recs[0]?.rejectionReasons?.[0]?.actual).toMatchObject({ priceLevel: 4 });
  });

  it("does not expose a private price conflict as a group reason", async () => {
    const gee = createPersonalAgentPrincipal({ userId: "usr_gee", eventId: "evt_a" });
    const sarah = createPersonalAgentPrincipal({ userId: "usr_sarah", eventId: "evt_a" });
    const constraints: CouncilConstraint[] = [
      {
        id: "c1",
        eventId: "evt_a",
        participantId: "usr_gee",
        type: "CUISINE_PREFER",
        value: ["steak"],
        priority: "MEDIUM",
        visibility: "PUBLIC"
      },
      {
        id: "c2",
        eventId: "evt_a",
        participantId: "usr_sarah",
        type: "MAX_PRICE_LEVEL",
        value: 2,
        priority: "HIGH",
        visibility: "PRIVATE_DERIVED"
      }
    ];
    const geeEval = evaluateCandidate({ principal: gee, candidate: stk, constraints });
    const sarahEval = evaluateCandidate({ principal: sarah, candidate: stk, constraints });
    const recs = await negotiate({
      principal: createNegotiatorPrincipal("evt_a"),
      eventId: "evt_a",
      constraints,
      candidates: [stk],
      evaluations: [geeEval, sarahEval]
    });
    expect(recs[0]?.rejected).toBe(true);
    expect(recs[0]?.rejectionReasons ?? []).toEqual([]);
    expect(JSON.stringify(recs)).not.toContain("MAX_PRICE_LEVEL");
    expect(JSON.stringify(recs)).not.toContain("$60+");
  });

  it("strips stuffed private reasons from the client snapshot", () => {
    const client = sanitizeCouncilSnapshotForClients({
      sessionId: "csn_1",
      eventId: "evt_a",
      status: "COMPLETE",
      participants: [],
      negotiatorId: "agent_negotiator_evt_a",
      constraints: [
        {
          id: "cst_private",
          eventId: "evt_a",
          participantId: "usr_sarah",
          type: "MAX_PRICE_LEVEL",
          value: 2,
          priority: "HIGH",
          visibility: "PRIVATE_DERIVED"
        }
      ],
      candidates: [],
      evaluations: [],
      recommendations: [
        {
          candidate: stk,
          councilScore: 0,
          evaluations: [],
          explanations: [],
          rejected: true,
          rejectionSummary: "Rejected — conflicts with a private high-priority preference.",
          rejectionReasons: [
            {
              participantId: "usr_sarah",
              constraintType: "MAX_PRICE_LEVEL",
              priority: "HIGH",
              required: 2,
              actual: { priceLevel: 4 },
              summary: "Max price is $$; this restaurant is $$$$"
            }
          ]
        }
      ],
      events: []
    });
    expect(client.recommendations[0]?.rejectionReasons ?? []).toEqual([]);
    expect(JSON.stringify(client)).not.toContain("MAX_PRICE_LEVEL");
  });

  it("does not treat uncertain dairy-free evidence as a rejection reason", () => {
    const cafe = {
      id: "rst_caroline",
      name: "Caroline",
      rating: 4.8,
      cuisines: ["american"],
      latitude: 30.26,
      longitude: -97.74,
      dietaryAssessments: [
        {
          restaurantId: "rst_caroline",
          requirement: "dairy-free",
          status: "uncertain" as const,
          confidence: 0.2,
          evidence: [],
          analyzedAt: "2026-09-16T00:00:00.000Z"
        }
      ]
    };
    const constraints: CouncilConstraint[] = [
      {
        id: "c1",
        eventId: "evt_a",
        participantId: "usr_jamie",
        type: "DIETARY",
        value: [{ requirement: "dairy-free", strength: "required", evidenceRequirement: "normal" }],
        priority: "HARD",
        visibility: "PUBLIC"
      }
    ];
    const reasons = publicRejectionReasons(cafe, constraints, [
      { participantId: "usr_jamie", rejected: true, privateConflict: false }
    ]);
    expect(reasons).toEqual([]);
    expect(JSON.stringify(reasons)).not.toContain("this restaurant is dairy-free");
  });

  it("explains unsupported dairy-free without claiming the restaurant is dairy-free", () => {
    const cafe = {
      id: "rst_ember",
      name: "Ember",
      rating: 4.2,
      cuisines: ["pizza"],
      latitude: 40.76,
      longitude: -73.98,
      dietaryAssessments: [
        {
          restaurantId: "rst_ember",
          requirement: "dairy-free",
          status: "unsupported" as const,
          confidence: 0.8,
          evidence: [],
          analyzedAt: "2026-09-16T00:00:00.000Z"
        }
      ]
    };
    const constraints: CouncilConstraint[] = [
      {
        id: "c1",
        eventId: "evt_a",
        participantId: "usr_jamie",
        type: "DIETARY",
        value: [{ requirement: "dairy-free", strength: "required" }],
        priority: "HARD",
        visibility: "PUBLIC"
      }
    ];
    const reasons = publicRejectionReasons(cafe, constraints, [
      { participantId: "usr_jamie", rejected: true, privateConflict: false }
    ]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.summary).toContain("does not support");
    expect(reasons[0]?.summary).not.toContain("this restaurant is dairy-free");
  });

  it("explains a public price conflict even when the restaurant has no listed price", () => {
    const cafe = {
      id: "rst_cafe",
      name: "Caroline",
      rating: 4.8,
      cuisines: ["american", "coffee shop"],
      latitude: 30.26,
      longitude: -97.74
    };
    const constraints: CouncilConstraint[] = [
      {
        id: "c1",
        eventId: "evt_a",
        participantId: "usr_gee",
        type: "MAX_PRICE_LEVEL",
        value: 2,
        priority: "HARD",
        visibility: "PUBLIC"
      }
    ];
    const reasons = publicRejectionReasons(cafe, constraints, [
      { participantId: "usr_gee", rejected: true, privateConflict: false }
    ]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.summary).toContain("not listed");
    expect(reasons[0]?.required).toBe(2);
  });
});
