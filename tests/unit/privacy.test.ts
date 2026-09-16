import { sanitizePreferenceForViewer, textRequestsSecrecy } from "@rc/domain";
import {
  CouncilConstraintSchema,
  sanitizeCouncilSnapshotForClients,
  type CouncilSnapshot
} from "@rc/protocol";
import { describe, expect, it } from "vitest";

const sarahPrice = {
  id: "prf_1",
  eventId: "evt_a",
  userId: "usr_sarah",
  category: "price" as const,
  visibility: "PRIVATE" as const,
  priority: "HIGH" as const,
  value: { maxPriceLevel: 2 },
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z"
};

describe("preference sanitization", () => {
  it("hides another participant's private preference entirely", () => {
    expect(sanitizePreferenceForViewer(sarahPrice, "usr_gee")).toBeNull();
  });

  it("lets the owner see their private preference", () => {
    expect(sanitizePreferenceForViewer(sarahPrice, "usr_sarah")?.value).toEqual({
      maxPriceLevel: 2
    });
  });

  it("leaves public preferences visible to the group", () => {
    const publicPref = { ...sarahPrice, visibility: "PUBLIC" as const };
    expect(sanitizePreferenceForViewer(publicPref, "usr_gee")?.category).toBe("price");
  });
});

describe("secrecy language in notes", () => {
  it("detects requests not to tell the group", () => {
    expect(textRequestsSecrecy("dont tell everybody I need cheap")).toBe(true);
    expect(textRequestsSecrecy("Keep this private — under $30")).toBe(true);
    expect(textRequestsSecrecy("I like steak")).toBe(false);
  });
});

describe("protocol schemas", () => {
  it("accepts a derived constraint without source text", () => {
    const parsed = CouncilConstraintSchema.parse({
      id: "cst_1",
      eventId: "evt_a",
      participantId: "usr_sarah",
      type: "MAX_PRICE_LEVEL",
      value: 2,
      priority: "HIGH",
      visibility: "PRIVATE_DERIVED"
    });
    expect(parsed.visibility).toBe("PRIVATE_DERIVED");
  });
});

describe("dietary privacy", () => {
  it("reduces a private dairy allergy story to a strict dietary constraint", async () => {
    const { deriveConstraints } = await import("@rc/agents");
    const { createPersonalAgentPrincipal } = await import("@rc/auth");
    const constraints = await deriveConstraints({
      principal: createPersonalAgentPrincipal({ userId: "usr_sarah", eventId: "evt_a" }),
      eventId: "evt_a",
      publicPreferences: [],
      privateRecords: [
        {
          id: "pvt_1",
          preferenceId: "prf_1",
          userId: "usr_sarah",
          eventId: "evt_a",
          category: "freeform",
          sourceText: "I have a severe dairy allergy. Please don't tell everyone why.",
          structuredValue: {},
          createdAt: "2026-09-16T00:00:00.000Z",
          updatedAt: "2026-09-16T00:00:00.000Z"
        }
      ]
    });
    expect(constraints).toHaveLength(1);
    expect(constraints[0]?.type).toBe("DIETARY");
    expect(constraints[0]?.visibility).toBe("PRIVATE_DERIVED");
    expect(constraints[0]?.value).toEqual([
      { requirement: "dairy-free", strength: "required", evidenceRequirement: "strict" }
    ]);
    const serialized = JSON.stringify(constraints);
    expect(serialized).not.toMatch(/allergy/i);
    expect(serialized).not.toContain("don't tell");
    expect(serialized).not.toContain("usr_sarah's");
  });
});

describe("client council snapshots", () => {
  it("omits private derived constraints so category and owner stay hidden", () => {
    const snapshot = {
      sessionId: "csn_1",
      eventId: "evt_a",
      status: "COMPLETE",
      participants: [],
      negotiatorId: "agent_negotiator_evt_a",
      constraints: [
        {
          id: "cst_public",
          eventId: "evt_a",
          participantId: "usr_gee",
          type: "CUISINE_PREFER",
          value: ["steak"],
          priority: "MEDIUM",
          visibility: "PUBLIC"
        },
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
      recommendations: [],
      events: []
    } as CouncilSnapshot;

    const client = sanitizeCouncilSnapshotForClients(snapshot);
    expect(client.constraints).toHaveLength(1);
    expect(client.constraints[0]?.id).toBe("cst_public");
    expect(JSON.stringify(client)).not.toContain("MAX_PRICE_LEVEL");
    expect(snapshot.constraints).toHaveLength(2);
  });
});
