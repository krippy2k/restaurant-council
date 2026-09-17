import { describe, expect, it } from "vitest";
import type { CouncilProgress, CouncilSnapshot } from "@rc/protocol";
import {
  ProgressReporter,
  TOOLS,
  CouncilSpendTracker,
  negotiatorProgress,
  personalAgentProgress,
  runCouncil,
  type CouncilDependencies
} from "@rc/orchestration";
import type { Event, EventMember, Preference, User } from "@rc/domain";
import { FixtureRestaurantSearch } from "@rc/tools";
import { parseFreeform } from "@rc/agents";

function snapshot(): CouncilSnapshot {
  return {
    sessionId: "csn_1",
    eventId: "evt_a",
    status: "CREATED",
    participants: [{ userId: "usr_gee", displayName: "Gee", agentId: "pag_gee" }],
    negotiatorId: "neg_1",
    constraints: [],
    candidates: [],
    evaluations: [],
    recommendations: [],
    events: []
  };
}

describe("council progress reporter", () => {
  it("tracks the innermost tool and restores the step timer after it finishes", async () => {
    const published: CouncilProgress[] = [];
    const reporter = new ProgressReporter(
      snapshot(),
      async (progress) => {
        published.push({ ...progress, tool: progress.tool ? { ...progress.tool } : undefined });
      },
      "2026-09-16T17:00:00.000Z"
    );
    await reporter.begin({
      phase: "SEARCHING",
      agent: negotiatorProgress()
    });
    await reporter.withTool(TOOLS.search, async () => {
      await reporter.withTool(TOOLS.details, async () => undefined, "STK");
    });
    expect(published.some((item) => item.tool?.id === "restaurants.search")).toBe(true);
    expect(published.some((item) => item.tool?.id === "restaurants.details" && item.detail === "STK")).toBe(
      true
    );
    const last = published.at(-1);
    expect(last?.tool).toBeUndefined();
    expect(last?.agent?.name).toBe("Negotiator");
    expect(last?.step).toBe("Searching restaurants");
  });

  it("includes live spend on published progress", async () => {
    const spend = new CouncilSpendTracker();
    spend.addAgent({
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 0,
      cachedInputTokens: 0
    });
    const published: CouncilProgress[] = [];
    const reporter = new ProgressReporter(
      snapshot(),
      async (progress) => {
        published.push(progress);
      },
      "2026-09-16T17:00:00.000Z",
      spend
    );
    await reporter.begin({ phase: "EVALUATING", agent: negotiatorProgress() });
    expect(published.at(-1)?.spend?.agents.calls).toBe(1);
    expect(published.at(-1)?.spend?.estimatedUsd).toBeGreaterThan(0);
  });

  it("names a personal agent without leaking private notes", async () => {
    const agent = personalAgentProgress("Sarah", "usr_sarah");
    expect(agent?.name).toBe("Sarah's Personal Agent");
    expect(JSON.stringify(agent)).not.toContain("under $30");
  });
});

describe("council run progress", () => {
  it("publishes workflow phases, agents, and tools", async () => {
    const gee: User = {
      id: "usr_gee",
      displayName: "Gee",
      email: "gee@example.com",
      createdAt: "2026-09-15T00:00:00.000Z"
    };
    const event: Event = {
      id: "evt_progress",
      ownerId: gee.id,
      name: "Dinner",
      location: { latitude: 40.758, longitude: -73.9855 },
      status: "collecting_preferences",
      createdAt: gee.createdAt,
      updatedAt: gee.createdAt
    };
    const members: EventMember[] = [
      { eventId: event.id, userId: gee.id, role: "owner", status: "joined" }
    ];
    const publicPreferences: Preference[] = [
      {
        id: "prf_public",
        eventId: event.id,
        userId: gee.id,
        category: "cuisine",
        visibility: "PUBLIC",
        priority: "MEDIUM",
        value: { cuisines: ["steak"] },
        createdAt: event.createdAt,
        updatedAt: event.updatedAt
      }
    ];
    const snapshots: CouncilSnapshot[] = [];
    const deps: CouncilDependencies = {
      getEvent: async () => event,
      listMembers: async () => members,
      getUser: async () => gee,
      listPublicPreferences: async () => publicPreferences,
      readVaultForAgent: async () => [],
      saveConstraints: async () => undefined,
      restaurants: new FixtureRestaurantSearch(),
      runtime: {
        model: "gpt-4o-mini",
        completeStructured: async ({ schema, user }) => {
          const payload = JSON.parse(user) as {
            publicNotes?: string[];
            privateNotes?: string[];
            candidates?: unknown[];
            evaluations?: unknown[];
          };
          if (payload.privateNotes || payload.publicNotes) {
            return schema.parse({
              publicConstraints: (payload.publicNotes ?? []).flatMap(parseFreeform),
              privateConstraints: (payload.privateNotes ?? []).flatMap(parseFreeform)
            });
          }
          if (Array.isArray(payload.candidates)) {
            return schema.parse({ evaluations: [] });
          }
          return schema.parse({ picks: [] });
        }
      },
      emit: async (_event, next) => {
        snapshots.push(structuredClone(next));
      },
      persist: async () => undefined,
      audit: async () => undefined
    };

    const result = await runCouncil(event.id, deps);
    const phases = snapshots.map((item) => item.progress?.phase);
    expect(phases).toContain("DERIVING_CONSTRAINTS");
    expect(phases).toContain("SEARCHING");
    expect(phases).toContain("EVALUATING");
    expect(phases).toContain("NEGOTIATING");
    expect(result.progress?.phase).toBe("COMPLETE");
    expect(result.progress?.completedAt).toBeTruthy();
    expect(snapshots.some((item) => item.progress?.agent?.name === "Gee's Personal Agent")).toBe(true);
    expect(snapshots.some((item) => item.progress?.tool?.name === "Language model")).toBe(true);
    expect(snapshots.some((item) => item.progress?.tool?.name === "Restaurant search")).toBe(true);
    expect(JSON.stringify(result.progress)).not.toContain("sourceText");
    const llmLogs = result.agentLogs?.filter((item) => item.kind === "llm") ?? [];
    expect(llmLogs.length).toBeGreaterThan(0);
    expect(llmLogs.some((item) => item.name === "Score restaurants")).toBe(true);
    expect(llmLogs.some((item) => item.name === "Negotiate picks")).toBe(true);
    expect(llmLogs.every((item) => item.input && item.output && item.status === "ok")).toBe(true);
    expect(llmLogs.every((item) => item.model === "gpt-4o-mini")).toBe(true);
    expect(result.agentLogs?.some((item) => item.tool?.id === "restaurants.search")).toBe(true);
  });

  it("logs agent prompts without private notes", async () => {
    const gee: User = {
      id: "usr_gee",
      displayName: "Gee",
      email: "gee@example.com",
      createdAt: "2026-09-15T00:00:00.000Z"
    };
    const event: Event = {
      id: "evt_private_logs",
      ownerId: gee.id,
      name: "Dinner",
      location: { latitude: 40.758, longitude: -73.9855 },
      status: "collecting_preferences",
      createdAt: gee.createdAt,
      updatedAt: gee.createdAt
    };
    const deps: CouncilDependencies = {
      getEvent: async () => event,
      listMembers: async () => [{ eventId: event.id, userId: gee.id, role: "owner", status: "joined" }],
      getUser: async () => gee,
      listPublicPreferences: async () => [],
      readVaultForAgent: async () => [
        {
          id: "pvt_1",
          preferenceId: "prf_1",
          userId: gee.id,
          eventId: event.id,
          category: "freeform",
          sourceText: "I lost my job. Keep this under $30. Don't tell anyone.",
          structuredValue: {},
          createdAt: event.createdAt,
          updatedAt: event.createdAt
        }
      ],
      saveConstraints: async () => undefined,
      restaurants: new FixtureRestaurantSearch(),
      runtime: {
        completeStructured: async ({ schema, user }) => {
          const payload = JSON.parse(user) as {
            publicNotes?: string[];
            privateNotes?: string[];
            candidates?: unknown[];
          };
          if (payload.privateNotes || payload.publicNotes) {
            return schema.parse({
              publicConstraints: (payload.publicNotes ?? []).flatMap(parseFreeform),
              privateConstraints: (payload.privateNotes ?? []).flatMap(parseFreeform)
            });
          }
          if (Array.isArray(payload.candidates)) {
            return schema.parse({ evaluations: [] });
          }
          return schema.parse({ picks: [] });
        }
      },
      emit: async () => undefined,
      persist: async () => undefined,
      audit: async () => undefined
    };
    const result = await runCouncil(event.id, deps);
    const serialized = JSON.stringify(result.agentLogs);
    expect(serialized).not.toContain("lost my job");
    expect(serialized).not.toContain("Don't tell anyone");
    expect(serialized).not.toContain("sourceText");
    const derive = result.agentLogs?.find((item) => item.name === "Derive constraints");
    expect(derive?.input).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          privateNotes: { redacted: true, count: 1 }
        })
      })
    );
    expect(derive?.output).toEqual(
      expect.objectContaining({
        privateConstraints: { redacted: true, count: expect.any(Number) }
      })
    );
  });
});
