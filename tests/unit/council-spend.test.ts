import { describe, expect, it } from "vitest";
import { estimateAgentUsd } from "@rc/agents";
import { DETAILS_FIELD_MASK, DISCOVERY_FIELD_MASK, HOURS_FIELD_MASK, estimatePlacesRequest } from "@rc/tools";
import { CouncilSpendTracker } from "@rc/orchestration";

describe("council spend estimates", () => {
  it("bills discovery at Nearby Search Enterprise", () => {
    const billed = estimatePlacesRequest(
      "https://places.googleapis.com/v1/places:searchNearby",
      DISCOVERY_FIELD_MASK
    );
    expect(billed.operation).toBe("nearby-search");
    expect(billed.sku).toBe("Nearby Search Enterprise");
    expect(billed.estimatedUsd).toBe(0.035);
  });

  it("bills hours-only details at Place Details Enterprise", () => {
    const billed = estimatePlacesRequest(
      "https://places.googleapis.com/v1/places/ChIJ-test",
      HOURS_FIELD_MASK
    );
    expect(billed.sku).toBe("Place Details Enterprise");
    expect(billed.estimatedUsd).toBe(0.02);
  });

  it("bills full details at Enterprise + Atmosphere because of reviews", () => {
    const billed = estimatePlacesRequest(
      "https://places.googleapis.com/v1/places/ChIJ-test",
      DETAILS_FIELD_MASK
    );
    expect(billed.sku).toBe("Place Details Enterprise + Atmosphere");
    expect(billed.estimatedUsd).toBe(0.025);
  });

  it("bills photo media separately", () => {
    const billed = estimatePlacesRequest(
      "https://places.googleapis.com/v1/places/ChIJ-test/photos/abc/media?maxWidthPx=800",
      ""
    );
    expect(billed.operation).toBe("place-photos");
    expect(billed.estimatedUsd).toBe(0.007);
  });

  it("prices gpt-4o-mini tokens at list rates", () => {
    expect(
      estimateAgentUsd({
        model: "gpt-4o-mini",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cachedInputTokens: 0
      })
    ).toBe(0.75);
  });

  it("accumulates agent and Places spend for a council run", () => {
    const spend = new CouncilSpendTracker();
    spend.addAgent({
      model: "gpt-4o-mini",
      inputTokens: 2000,
      outputTokens: 500,
      cachedInputTokens: 0
    });
    spend.addPlacesHttp("https://places.googleapis.com/v1/places:searchNearby", DISCOVERY_FIELD_MASK);
    spend.addPlacesHttp("https://places.googleapis.com/v1/places/ChIJ-1", HOURS_FIELD_MASK);
    const snapshot = spend.snapshot();
    expect(snapshot.agents.calls).toBe(1);
    expect(snapshot.places.search).toBe(1);
    expect(snapshot.places.hours).toBe(1);
    expect(snapshot.places.details).toBe(0);
    expect(snapshot.estimatedUsd).toBeCloseTo(0.035 + 0.02 + 0.0006, 6);
    expect(snapshot.agents.byModel).toEqual([
      expect.objectContaining({
        model: "gpt-4o-mini",
        calls: 1,
        inputTokens: 2000,
        outputTokens: 500
      })
    ]);
  });

  it("breaks agent spend down by model", () => {
    const spend = new CouncilSpendTracker();
    spend.addAgent({
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 0,
      cachedInputTokens: 0
    });
    spend.addAgent({
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 0,
      cachedInputTokens: 0
    });
    const snapshot = spend.snapshot();
    expect(snapshot.agents.calls).toBe(2);
    expect(snapshot.agents.byModel?.map((item) => item.model)).toEqual(["gpt-4o-mini", "gpt-4o"]);
    const mini = snapshot.agents.byModel?.find((item) => item.model === "gpt-4o-mini");
    const full = snapshot.agents.byModel?.find((item) => item.model === "gpt-4o");
    expect(mini?.estimatedUsd).toBeLessThan(full?.estimatedUsd ?? 0);
  });

  it("counts Places cache hits separately from billed calls", () => {
    const spend = new CouncilSpendTracker();
    spend.addPlacesHttp("https://places.googleapis.com/v1/places:searchNearby", DISCOVERY_FIELD_MASK);
    spend.addPlacesCache("hours");
    spend.addPlacesCache("hours");
    spend.addPlacesCache("details");
    const snapshot = spend.snapshot();
    expect(snapshot.places.calls).toBe(1);
    expect(snapshot.places.search).toBe(1);
    expect(snapshot.places.cachedCalls).toBe(3);
    expect(snapshot.places.cachedHours).toBe(2);
    expect(snapshot.places.cachedDetails).toBe(1);
    expect(snapshot.places.estimatedUsd).toBe(0.035);
  });
});
