import { createPersonalAgentPrincipal } from "@rc/auth";
import { evaluateCandidates } from "@rc/agents";
import { describe, expect, it } from "vitest";
import {
  EvaluationsLlmSchema,
  NegotiationLlmSchema
} from "../../packages/agents/src/schemas.ts";

describe("LLM evaluation schema", () => {
  it("coerces REJECTED labels and constraint-type reason codes", () => {
    const parsed = EvaluationsLlmSchema.parse({
      evaluations: [
        {
          candidateId: "rst_stk",
          score: 20,
          label: "REJECTED",
          reasonCode: "PRICE_LEVEL",
          rejected: true,
          privateConflict: false
        },
        {
          candidateId: "rst_thai",
          score: 40,
          label: "REJECTED",
          reasonCode: "CUISINE_PREFER",
          rejected: true,
          privateConflict: false
        },
        {
          candidateId: "rst_ok",
          score: 88,
          label: "Strong match",
          reasonCode: "MATCH",
          rejected: false,
          privateConflict: false
        }
      ]
    });
    expect(parsed.evaluations).toEqual([
      expect.objectContaining({
        candidateId: "rst_stk",
        label: "Constraint conflict",
        reasonCode: "PUBLIC_CONSTRAINT_CONFLICT",
        rejected: true
      }),
      expect.objectContaining({
        candidateId: "rst_thai",
        label: "Constraint conflict",
        reasonCode: "PUBLIC_CONSTRAINT_CONFLICT",
        rejected: true
      }),
      expect.objectContaining({
        candidateId: "rst_ok",
        label: "Strong match",
        reasonCode: "MATCH",
        rejected: false
      })
    ]);
  });

  it("scales 1-5 Good match scores onto 0-100", () => {
    const parsed = EvaluationsLlmSchema.parse({
      evaluations: [
        {
          candidateId: "rst_ok",
          score: 3,
          label: "Good match",
          reasonCode: "MATCH",
          rejected: false,
          privateConflict: false
        }
      ]
    });
    expect(parsed.evaluations[0]).toEqual(
      expect.objectContaining({
        candidateId: "rst_ok",
        score: 70,
        label: "Good match",
        rejected: false
      })
    );
  });

  it("lets evaluateCandidates use coerced model output instead of failing", async () => {
    const principal = createPersonalAgentPrincipal({
      userId: "usr_gee",
      eventId: "evt_a"
    });
    const evaluations = await evaluateCandidates({
      principal,
      constraints: [
        {
          id: "c1",
          eventId: "evt_a",
          participantId: "usr_gee",
          type: "MAX_PRICE_LEVEL",
          value: 2,
          priority: "HARD",
          visibility: "PUBLIC"
        }
      ],
      candidates: [
        {
          id: "rst_stk",
          name: "STK",
          priceLevel: 4,
          rating: 4.4,
          cuisines: ["steak"],
          latitude: 40.76,
          longitude: -73.98
        }
      ],
      runtime: {
        completeStructured: async ({ schema }) =>
          schema.parse({
            evaluations: [
              {
                candidateId: "rst_stk",
                score: 12,
                label: "REJECTED",
                reasonCode: "PRICE_LEVEL",
                rejected: true,
                privateConflict: false
              }
            ]
          })
      }
    });
    expect(evaluations).toEqual([
      expect.objectContaining({
        candidateId: "rst_stk",
        rejected: true,
        label: "Constraint conflict",
        reasonCode: "HARD_CONSTRAINT_CONFLICT"
      })
    ]);
  });

  it("drops invalid negotiator picks instead of failing", () => {
    const parsed = NegotiationLlmSchema.parse({
      picks: [{ name: "STK" }, { candidateId: "rst_ok", explanations: ["Outdoor seating"] }]
    });
    expect(parsed.picks).toEqual([
      { candidateId: "rst_ok", explanations: ["Outdoor seating"] }
    ]);
  });
});
