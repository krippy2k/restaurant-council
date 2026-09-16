import {
  assertAuthorized,
  authorize,
  createNegotiatorPrincipal,
  createPersonalAgentPrincipal,
  createUserPrincipal
} from "@rc/auth";
import { AppError, ErrorCodes } from "@rc/shared";
import { describe, expect, it } from "vitest";

const eventA = {
  type: "event" as const,
  eventId: "evt_a",
  ownerId: "usr_gee",
  memberIds: ["usr_gee", "usr_sarah"]
};

const sarahPrivate = {
  type: "preference" as const,
  userId: "usr_sarah",
  eventId: "evt_a",
  visibility: "PRIVATE" as const
};

describe("authorization boundaries", () => {
  it("denies Gee reading Sarah's private preferences", () => {
    const decision = authorize({
      principal: createUserPrincipal("usr_gee"),
      action: "preference.private.read",
      resource: sarahPrivate
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("FORBIDDEN");
  });

  it("allows Sarah to read her private preferences", () => {
    const decision = authorize({
      principal: createUserPrincipal("usr_sarah"),
      action: "preference.private.read",
      resource: sarahPrivate
    });
    expect(decision.allowed).toBe(true);
  });

  it("denies GeeAgent reading Sarah's private preferences", () => {
    const decision = authorize({
      principal: createPersonalAgentPrincipal({ userId: "usr_gee", eventId: "evt_a" }),
      action: "preference.private.read",
      resource: sarahPrivate
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("AGENT_CAPABILITY_DENIED");
  });

  it("allows SarahAgent to read Sarah's private preferences", () => {
    const decision = authorize({
      principal: createPersonalAgentPrincipal({ userId: "usr_sarah", eventId: "evt_a" }),
      action: "preference.private.read",
      resource: sarahPrivate
    });
    expect(decision.allowed).toBe(true);
  });

  it("denies the Negotiator from reading source preferences", () => {
    const decision = authorize({
      principal: createNegotiatorPrincipal("evt_a"),
      action: "preference.private.read",
      resource: sarahPrivate
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("AGENT_CAPABILITY_DENIED");
    expect(decision.reason).toContain("negotiator");
  });

  it("still denies the Negotiator if a capability is incorrectly added", () => {
    const negotiator = createNegotiatorPrincipal("evt_a");
    negotiator.capabilities.push({
      resource: "preferences",
      action: "read",
      scope: "usr_sarah"
    });
    const decision = authorize({
      principal: negotiator,
      action: "preference.private.read",
      resource: sarahPrivate
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("AGENT_CAPABILITY_DENIED");
  });

  it("denies cross-event access", () => {
    const decision = authorize({
      principal: createUserPrincipal("usr_gee"),
      action: "event.read",
      resource: {
        type: "event",
        eventId: "evt_b",
        ownerId: "usr_mike",
        memberIds: ["usr_mike"]
      }
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("FORBIDDEN");
  });

  it("denies a personal agent scoped to another event", () => {
    const decision = authorize({
      principal: createPersonalAgentPrincipal({ userId: "usr_sarah", eventId: "evt_b" }),
      action: "preference.private.read",
      resource: sarahPrivate
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("AGENT_CAPABILITY_DENIED");
  });

  it("throws AGENT_CAPABILITY_DENIED from assertAuthorized", () => {
    expect(() =>
      assertAuthorized({
        principal: createNegotiatorPrincipal("evt_a"),
        action: "preference.private.read",
        resource: sarahPrivate
      })
    ).toThrow(AppError);
    try {
      assertAuthorized({
        principal: createNegotiatorPrincipal("evt_a"),
        action: "preference.private.read",
        resource: sarahPrivate
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCodes.AGENT_CAPABILITY_DENIED);
      expect((error as AppError).status).toBe(403);
    }
  });

  it("allows event members to read their event", () => {
    const decision = authorize({
      principal: createUserPrincipal("usr_sarah"),
      action: "event.read",
      resource: eventA
    });
    expect(decision.allowed).toBe(true);
  });

  it("requires the owner to start a council", () => {
    const member = authorize({
      principal: createUserPrincipal("usr_sarah"),
      action: "event.start_council",
      resource: eventA
    });
    const owner = authorize({
      principal: createUserPrincipal("usr_gee"),
      action: "event.start_council",
      resource: eventA
    });
    expect(member.allowed).toBe(false);
    expect(owner.allowed).toBe(true);
  });

  it("requires the owner to delete an event", () => {
    const member = authorize({
      principal: createUserPrincipal("usr_sarah"),
      action: "event.delete",
      resource: eventA
    });
    const owner = authorize({
      principal: createUserPrincipal("usr_gee"),
      action: "event.delete",
      resource: eventA
    });
    expect(member.allowed).toBe(false);
    expect(owner.allowed).toBe(true);
  });

  it("allows a user to update or delete their own preference", () => {
    const decision = authorize({
      principal: createUserPrincipal("usr_sarah"),
      action: "preference.own.write",
      resource: sarahPrivate
    });
    expect(decision.allowed).toBe(true);
  });

  it("denies a user updating or deleting another member's preference", () => {
    const decision = authorize({
      principal: createUserPrincipal("usr_gee"),
      action: "preference.own.write",
      resource: sarahPrivate
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("FORBIDDEN");
    expect(() =>
      assertAuthorized({
        principal: createUserPrincipal("usr_gee"),
        action: "preference.own.write",
        resource: sarahPrivate
      })
    ).toThrow(AppError);
  });
});
