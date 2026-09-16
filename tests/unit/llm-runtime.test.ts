import { createAgentRuntime, isSafeExplanation, LlmAgentRuntime, negotiate } from "@rc/agents";
import { createNegotiatorPrincipal } from "@rc/auth";
import { CandidateEvaluationSchema } from "@rc/protocol";
import { describe, expect, it } from "vitest";

describe("LLM runtime", () => {
  it("is unset without an API key", () => {
    expect(createAgentRuntime({})).toBeUndefined();
    expect(createAgentRuntime({ apiKey: "   " })).toBeUndefined();
  });

  it("parses structured JSON from an OpenAI-compatible response", async () => {
    const runtime = new LlmAgentRuntime({
      apiKey: "test-key",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    candidateId: "rst_stk",
                    participantId: "usr_gee",
                    score: 80,
                    label: "Good match",
                    reasonCode: "MATCH",
                    rejected: false,
                    privateConflict: false
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )) as typeof fetch
    });
    const result = await runtime.completeStructured({
      system: "test",
      user: "test",
      schema: CandidateEvaluationSchema
    });
    expect(result.score).toBe(80);
  });

  it("rejects model output that fails the schema", async () => {
    const runtime = new LlmAgentRuntime({
      apiKey: "test-key",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ score: "nope" }) } }]
          }),
          { status: 200 }
        )) as typeof fetch
    });
    await expect(
      runtime.completeStructured({
        system: "test",
        user: "test",
        schema: CandidateEvaluationSchema
      })
    ).rejects.toThrow();
  });
});

describe("negotiator explanation safety", () => {
  it("rejects explanations that reveal private money reasons", () => {
    expect(isSafeExplanation("Outdoor seating available")).toBe(true);
    expect(isSafeExplanation("Sarah can't afford this")).toBe(false);
    expect(isSafeExplanation("Conflicts with her budget")).toBe(false);
  });

  it("does not keep a hallucinated member total from the model", async () => {
    const candidate = {
      id: "rst_ok",
      name: "OK Noodle",
      priceLevel: 2,
      rating: 4.5,
      cuisines: ["thai"],
      latitude: 40.76,
      longitude: -73.98
    };
    const evaluations = ["usr_a", "usr_b", "usr_c"].map((participantId) => ({
      candidateId: candidate.id,
      participantId,
      score: 90,
      label: "Strong match" as const,
      reasonCode: "MATCH" as const,
      rejected: false,
      privateConflict: false
    }));
    const recs = await negotiate({
      principal: createNegotiatorPrincipal("evt_a"),
      eventId: "evt_a",
      constraints: [],
      candidates: [candidate],
      evaluations,
      runtime: {
        completeStructured: async ({ schema }) =>
          schema.parse({
            picks: [
              {
                candidateId: candidate.id,
                explanations: ["Strong match for 3/4 members", "Outdoor seating available"]
              }
            ]
          })
      }
    });
    expect(recs[0]?.explanations).toContain("Strong match for 3/3 members");
    expect(recs[0]?.explanations.some((item) => item.includes("3/4"))).toBe(false);
    expect(recs[0]?.explanations).toContain("Outdoor seating available");
  });
});
