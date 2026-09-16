import { evaluateCandidate, negotiate, parseFreeform } from "@rc/agents";
import {
  createNegotiatorPrincipal,
  createPersonalAgentPrincipal
} from "@rc/auth";
import { runCouncil, type CouncilDependencies } from "@rc/orchestration";
import type { Event, EventMember, Preference, PrivatePreferenceRecord, User } from "@rc/domain";
import type { CouncilConstraint, CouncilSnapshot } from "@rc/protocol";
import { AppError, ErrorCodes } from "@rc/shared";
import { FixtureRestaurantSearch } from "@rc/tools";
import { describe, expect, it } from "vitest";

function user(id: string, displayName: string): User {
  return { id, displayName, email: `${id}@example.com`, createdAt: "2026-09-15T00:00:00.000Z" };
}

describe("council orchestration", () => {
  it("lets a private price constraint reject expensive restaurants without leaking source text", async () => {
    const gee = user("usr_gee", "Gee");
    const sarah = user("usr_sarah", "Sarah");
    const event: Event = {
      id: "evt_a",
      ownerId: gee.id,
      name: "Dinner Saturday",
      location: { latitude: 40.758, longitude: -73.9855 },
      status: "collecting_preferences",
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z"
    };
    const members: EventMember[] = [
      { eventId: event.id, userId: gee.id, role: "owner", status: "joined" },
      { eventId: event.id, userId: sarah.id, role: "member", status: "joined" }
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
    const vault: PrivatePreferenceRecord[] = [
      {
        id: "pvt_1",
        preferenceId: "prf_private",
        userId: sarah.id,
        eventId: event.id,
        category: "freeform",
        sourceText: "I lost my job. Keep it under $30 and do not tell the table.",
        structuredValue: {},
        createdAt: event.createdAt,
        updatedAt: event.updatedAt
      }
    ];

    const snapshots: CouncilSnapshot[] = [];
    const deps: CouncilDependencies = {
      getEvent: async () => event,
      listMembers: async () => members,
      getUser: async (id) => (id === gee.id ? gee : sarah),
      listPublicPreferences: async () => publicPreferences,
      readVaultForAgent: async (principal, userId) => {
        if (principal.actingFor !== userId) throw new Error("vault leak");
        return vault.filter((record) => record.userId === userId);
      },
      saveConstraints: async () => undefined,
      restaurants: new FixtureRestaurantSearch(),
      runtime: {
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
          if (Array.isArray(payload.evaluations)) {
            return schema.parse({ picks: [] });
          }
          if (Array.isArray(payload.candidates)) {
            return schema.parse({ evaluations: [] });
          }
          return schema.parse({ picks: [] });
        }
      },
      emit: async (_event, snapshot) => {
        snapshots.push(structuredClone(snapshot));
      },
      persist: async () => undefined,
      audit: async () => undefined
    };

    const result = await runCouncil(event.id, deps);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("lost my job");
    expect(serialized).not.toContain("do not tell the table");

    const stk = result.candidates.find((candidate) => candidate.name === "STK");
    expect(stk).toBeTruthy();
    const stkEval = result.evaluations.find(
      (evaluation) => evaluation.candidateId === stk?.id && evaluation.participantId === sarah.id
    );
    expect(stkEval?.rejected).toBe(true);
    expect(stkEval?.privateConflict).toBe(true);
    expect(stkEval?.reasonCode).toBe("PRIVATE_CONSTRAINT_CONFLICT");

    const recommendedNames = result.recommendations.map((item) => item.candidate.name);
    expect(recommendedNames.includes("STK")).toBe(false);
    expect(result.recommendations.some((item) => item.councilScore > 0)).toBe(true);
    expect(snapshots.length).toBeGreaterThan(3);
  });

  it("personal agents score candidates independently", async () => {
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
    const stk = {
      id: "rst_stk",
      name: "STK",
      priceLevel: 4 as const,
      rating: 4.4,
      cuisines: ["steak"],
      latitude: 40.76,
      longitude: -73.98
    };
    const geeEval = evaluateCandidate({ principal: gee, candidate: stk, constraints });
    const sarahEval = evaluateCandidate({ principal: sarah, candidate: stk, constraints });
    expect(geeEval.rejected).toBe(false);
    expect(sarahEval.rejected).toBe(true);
    expect(sarahEval.privateConflict).toBe(true);

    const recs = await negotiate({
      principal: createNegotiatorPrincipal("evt_a"),
      eventId: "evt_a",
      constraints,
      candidates: [stk],
      evaluations: [geeEval, sarahEval]
    });
    expect(recs[0]?.rejected).toBe(true);
    expect(recs[0]?.rejectionSummary).toContain("private");
    expect(JSON.stringify(recs)).not.toContain("under $30");
  });

  it("does not run a Council without an agent runtime", async () => {
    await expect(
      runCouncil("evt_a", {
        getEvent: async () => {
          throw new Error("should not run");
        },
        listMembers: async () => [],
        getUser: async () => {
          throw new Error("should not run");
        },
        listPublicPreferences: async () => [],
        readVaultForAgent: async () => [],
        saveConstraints: async () => undefined,
        restaurants: new FixtureRestaurantSearch(),
        emit: async () => undefined,
        persist: async () => undefined,
        audit: async () => undefined
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.AGENTS_NOT_CONFIGURED,
      status: 503
    } satisfies Partial<AppError>);
  });
});
