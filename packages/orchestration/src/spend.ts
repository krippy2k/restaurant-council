import { estimateAgentUsd, type AgentTokenUsage } from "@rc/agents";
import type { CouncilRunSpend } from "@rc/protocol";
import { estimatePlacesRequest, type PlacesBillableRequest, type PlacesCacheKind } from "@rc/tools";

function emptySpend(): CouncilRunSpend {
  return {
    currency: "USD",
    estimatedUsd: 0,
    agents: {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      estimatedUsd: 0,
      byModel: []
    },
    places: {
      calls: 0,
      search: 0,
      details: 0,
      hours: 0,
      photos: 0,
      cachedCalls: 0,
      cachedSearch: 0,
      cachedDetails: 0,
      cachedHours: 0,
      cachedPhotos: 0,
      estimatedUsd: 0
    }
  };
}

function roundUsd(amount: number): number {
  return Math.round(amount * 1_000_000) / 1_000_000;
}

export class CouncilSpendTracker {
  private current = emptySpend();

  addAgent(usage: AgentTokenUsage): void {
    const cost = estimateAgentUsd(usage);
    this.current.agents.calls += 1;
    this.current.agents.inputTokens += usage.inputTokens;
    this.current.agents.outputTokens += usage.outputTokens;
    this.current.agents.cachedInputTokens = (this.current.agents.cachedInputTokens ?? 0) + usage.cachedInputTokens;
    this.current.agents.estimatedUsd = roundUsd(this.current.agents.estimatedUsd + cost);
    const model = usage.model.trim() || "unknown";
    const models = this.current.agents.byModel ?? [];
    const existing = models.find((item) => item.model === model);
    if (existing) {
      existing.calls += 1;
      existing.inputTokens += usage.inputTokens;
      existing.outputTokens += usage.outputTokens;
      existing.cachedInputTokens = (existing.cachedInputTokens ?? 0) + usage.cachedInputTokens;
      existing.estimatedUsd = roundUsd(existing.estimatedUsd + cost);
    } else {
      models.push({
        model,
        calls: 1,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        estimatedUsd: cost
      });
    }
    this.current.agents.byModel = models;
    this.current.estimatedUsd = roundUsd(this.current.agents.estimatedUsd + this.current.places.estimatedUsd);
  }

  addPlaces(request: PlacesBillableRequest): void {
    this.current.places.calls += 1;
    this.current.places.estimatedUsd = roundUsd(this.current.places.estimatedUsd + request.estimatedUsd);
    if (request.operation === "nearby-search" || request.operation === "text-search") {
      this.current.places.search += 1;
    } else if (request.operation === "place-photos") {
      this.current.places.photos += 1;
    } else if (/\b(currentOpeningHours|regularOpeningHours)\b/.test(request.fieldMask) && !/\breviews\b/.test(request.fieldMask)) {
      this.current.places.hours += 1;
    } else {
      this.current.places.details += 1;
    }
    this.current.estimatedUsd = roundUsd(this.current.agents.estimatedUsd + this.current.places.estimatedUsd);
  }

  addPlacesCache(kind: PlacesCacheKind): void {
    this.current.places.cachedCalls = (this.current.places.cachedCalls ?? 0) + 1;
    if (kind === "search") this.current.places.cachedSearch = (this.current.places.cachedSearch ?? 0) + 1;
    else if (kind === "hours") this.current.places.cachedHours = (this.current.places.cachedHours ?? 0) + 1;
    else if (kind === "photos") this.current.places.cachedPhotos = (this.current.places.cachedPhotos ?? 0) + 1;
    else this.current.places.cachedDetails = (this.current.places.cachedDetails ?? 0) + 1;
  }

  addPlacesHttp(url: string, fieldMask = ""): void {
    this.addPlaces(estimatePlacesRequest(url, fieldMask));
  }

  snapshot(): CouncilRunSpend {
    return {
      currency: "USD",
      estimatedUsd: this.current.estimatedUsd,
      agents: {
        ...this.current.agents,
        byModel: (this.current.agents.byModel ?? []).map((item) => ({ ...item }))
      },
      places: { ...this.current.places }
    };
  }
}
