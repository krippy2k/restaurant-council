import {
  applyDecisionsToEvaluations,
  candidateStatus,
  claimVerificationTask,
  completeVerificationTask,
  detectPreferenceFromChat,
  newPreferencePrompt,
  releaseVerificationTask,
  verificationTasksFromCouncil
} from "@rc/agents";
import {
  authorize,
  createNegotiatorPrincipal,
  createPersonalAgentPrincipal,
  createUserPrincipal
} from "@rc/auth";
import { mergeHumanEvidenceIntoCandidates, mergeRestaurantMedia, reevaluateCouncil } from "@rc/orchestration";
import {
  decisionsForAgentContext,
  publicRejectionCopy,
  sanitizeChatMessage,
  sanitizeDecisionForViewer,
  sanitizeEvidenceForViewer,
  suggestedVerificationQuestion,
  type CandidateEvaluation,
  type CouncilSnapshot,
  type HumanEvidence,
  type RestaurantCandidate,
  type RestaurantDecision,
  type VerificationTask
} from "@rc/protocol";
import { AppError } from "@rc/shared";
import { assessDietaryEvidence, makeEvidence } from "@rc/tools";
import { describe, expect, it } from "vitest";

const PRIVATE_NOTE = "I went there before and hated it.";

function candidate(id: string, extra: Partial<RestaurantCandidate> = {}): RestaurantCandidate {
  return {
    id,
    name: id === "res_coopers" ? "Cooper's Hawk" : id,
    cuisines: ["american"],
    latitude: 40.758,
    longitude: -73.9855,
    priceLevel: 2,
    rating: 4.6,
    reviewCount: 2184,
    dietaryAssessments: [
      {
        restaurantId: id,
        requirement: "dairy-free",
        status: "uncertain",
        confidence: 0.4,
        analyzedAt: "2026-09-16T12:00:00.000Z",
        evidence: [
          makeEvidence({
            sourceType: "official-menu",
            sourceName: "Menu",
            excerpt: "Vegan dishes found",
            supports: "supports",
            reliability: "medium",
            scope: "location"
          })
        ]
      }
    ],
    ...extra
  };
}

function evaluation(
  candidateId: string,
  participantId: string,
  extra: Partial<CandidateEvaluation> = {}
): CandidateEvaluation {
  return {
    candidateId,
    participantId,
    score: 78,
    label: "Good match",
    reasonCode: "MATCH",
    rejected: false,
    privateConflict: false,
    ...extra
  };
}

function openTask(extra: Partial<VerificationTask> = {}): VerificationTask {
  return {
    id: "vtk_1",
    eventId: "evt_a",
    restaurantId: "res_coopers",
    requirementType: "dietary",
    requirementValue: "dairy-free",
    question: suggestedVerificationQuestion("dietary", "dairy-free"),
    status: "open",
    createdBy: { type: "system" },
    createdAt: "2026-09-16T12:00:00.000Z",
    ...extra
  };
}

function snapshot(extra: Partial<CouncilSnapshot> = {}): CouncilSnapshot {
  const coopers = candidate("res_coopers");
  const other = candidate("res_other", {
    name: "Other Place",
    dietaryAssessments: []
  });
  return {
    sessionId: "csn_1",
    eventId: "evt_a",
    status: "COMPLETE",
    participants: [
      { userId: "usr_gee", displayName: "Gee", agentId: "pag_gee" },
      { userId: "usr_mike", displayName: "Mike", agentId: "pag_mike" }
    ],
    negotiatorId: "neg_1",
    constraints: [
      {
        id: "cst_df",
        eventId: "evt_a",
        participantId: "usr_gee",
        type: "DIETARY",
        value: [{ requirement: "dairy-free", strength: "required" }],
        priority: "HARD",
        visibility: "PUBLIC"
      }
    ],
    candidates: [coopers, other],
    evaluations: [
      evaluation("res_coopers", "usr_gee"),
      evaluation("res_coopers", "usr_mike"),
      evaluation("res_other", "usr_gee", { score: 70 }),
      evaluation("res_other", "usr_mike", { score: 72 })
    ],
    recommendations: [],
    events: [],
    ...extra
  };
}

describe("verification tasks", () => {
  it("creates a task for a candidate with uncertain dietary evidence", () => {
    const tasks = verificationTasksFromCouncil({
      eventId: "evt_a",
      candidates: snapshot().candidates,
      constraints: snapshot().constraints,
      evaluations: snapshot().evaluations,
      existing: []
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.restaurantId).toBe("res_coopers");
    expect(tasks[0]?.question).toMatch(/dairy-free/i);
    expect(tasks[0]?.status).toBe("open");
  });

  it("skips rejected restaurants and existing open tasks", () => {
    const tasks = verificationTasksFromCouncil({
      eventId: "evt_a",
      candidates: snapshot().candidates,
      constraints: snapshot().constraints,
      evaluations: [
        evaluation("res_coopers", "usr_gee", { rejected: true, score: 0 }),
        evaluation("res_coopers", "usr_mike", { score: 90 })
      ],
      existing: []
    });
    expect(tasks).toEqual([]);
    const duplicates = verificationTasksFromCouncil({
      eventId: "evt_a",
      candidates: snapshot().candidates,
      constraints: snapshot().constraints,
      evaluations: snapshot().evaluations,
      existing: [openTask()]
    });
    expect(duplicates).toEqual([]);
  });

  it("still asks for verification when the council score is low", () => {
    const low = candidate("res_low");
    const tasks = verificationTasksFromCouncil({
      eventId: "evt_a",
      candidates: [low],
      constraints: snapshot().constraints,
      evaluations: [
        evaluation("res_low", "usr_gee", { score: 40 }),
        evaluation("res_low", "usr_mike", { score: 38 })
      ],
      existing: []
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.restaurantId).toBe("res_low");
  });

  it("asks someone to verify unknown opening hours", () => {
    const unknownHours = candidate("res_hours", {
      dietaryAssessments: [],
      hoursAssessment: {
        restaurantId: "res_hours",
        status: "unknown",
        eventDateTime: "2026-09-19T19:00:00.000Z",
        minimumOpenAfterEventMinutes: 60,
        requiredOpenUntil: "2026-09-19T20:00:00.000Z"
      }
    });
    const tasks = verificationTasksFromCouncil({
      eventId: "evt_a",
      candidates: [unknownHours],
      constraints: snapshot().constraints,
      evaluations: [evaluation("res_hours", "usr_gee", { score: 80 })],
      existing: []
    });
    expect(tasks.some((task) => task.requirementType === "opening-hours")).toBe(true);
    expect(tasks.find((task) => task.requirementType === "opening-hours")?.question).toMatch(/open/i);
  });

  it("claims, prevents invalid claim, releases, and completes", () => {
    const claimed = claimVerificationTask(openTask(), "usr_gee");
    expect(claimed.status).toBe("claimed");
    expect(claimed.assignedToUserId).toBe("usr_gee");
    expect(claimed.claimedAt).toBeTruthy();
    expect(() => claimVerificationTask(claimed, "usr_mike")).toThrow(AppError);
    const released = releaseVerificationTask(claimed, "usr_gee", false);
    expect(released.status).toBe("open");
    expect(released.assignedToUserId).toBeUndefined();
    expect(() => releaseVerificationTask(claimed, "usr_mike", false)).toThrow(AppError);
    const completed = completeVerificationTask(claimed, "usr_gee");
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeTruthy();
    expect(() => completeVerificationTask(openTask(), "usr_gee")).toThrow(AppError);
  });
});

describe("human evidence and dietary assessment", () => {
  it("records timestamped human evidence and upgrades uncertain to confirmed", () => {
    const evidence: HumanEvidence = {
      id: "hev_1",
      eventId: "evt_a",
      restaurantId: "res_coopers",
      requirementType: "dietary",
      requirementValue: "dairy-free",
      providedByUserId: "usr_gee",
      method: "phone",
      result: "supports",
      notes: "Several entrees can be prepared without butter or dairy.",
      verifiedAt: "2026-09-16T15:04:00.000Z",
      visibility: "event"
    };
    const merged = mergeHumanEvidenceIntoCandidates(snapshot(), [evidence]);
    const assessment = merged.candidates[0]?.dietaryAssessments?.[0];
    expect(assessment?.status).toBe("confirmed");
    expect(assessment?.evidence.some((item) => item.sourceType === "human-verification")).toBe(true);
    expect(assessment?.evidence.some((item) => item.observedAt === evidence.verifiedAt)).toBe(true);
    expect(JSON.stringify(assessment)).not.toContain("permanent boolean");
  });

  it("treats phone contradiction as unsupported without inventing a hard boolean flag", () => {
    const assessment = assessDietaryEvidence({
      restaurantId: "res_coopers",
      requirement: "dairy-free",
      evidence: [
        makeEvidence({
          sourceType: "human-verification",
          sourceName: "Participant verification",
          observedAt: "2026-09-16T15:04:00.000Z",
          excerpt: "Kitchen said they cannot avoid butter.",
          supports: "contradicts",
          reliability: "high",
          scope: "location"
        })
      ]
    });
    expect(assessment.status).toBe("unsupported");
    expect(assessment.evidence[0]?.sourceType).toBe("human-verification");
  });
});

describe("restaurant decisions", () => {
  it("lets prefer and dislike change ranking without a veto", () => {
    const base = [evaluation("res_coopers", "usr_gee", { score: 70 })];
    const preferred = applyDecisionsToEvaluations(base, [
      {
        id: "rdc_1",
        eventId: "evt_a",
        restaurantId: "res_coopers",
        userId: "usr_gee",
        decision: "prefer",
        visibility: "event",
        createdAt: "2026-09-16T12:00:00.000Z"
      }
    ]);
    const disliked = applyDecisionsToEvaluations(base, [
      {
        id: "rdc_2",
        eventId: "evt_a",
        restaurantId: "res_coopers",
        userId: "usr_gee",
        decision: "dislike",
        visibility: "event",
        createdAt: "2026-09-16T12:00:00.000Z"
      }
    ]);
    expect(preferred[0]?.rejected).toBe(false);
    expect(preferred[0]?.score).toBeGreaterThan(70);
    expect(disliked[0]?.rejected).toBe(false);
    expect(disliked[0]?.score).toBeLessThan(70);
  });

  it("treats reject as a veto and keeps private notes out of public views", () => {
    const decision: RestaurantDecision = {
      id: "rdc_3",
      eventId: "evt_a",
      restaurantId: "res_other",
      userId: "usr_mike",
      decision: "reject",
      reasonCategory: "previous-experience",
      note: PRIVATE_NOTE,
      visibility: "private",
      createdAt: "2026-09-16T12:00:00.000Z"
    };
    const next = applyDecisionsToEvaluations([evaluation("res_other", "usr_mike", { score: 80 })], [decision]);
    expect(next[0]?.rejected).toBe(true);
    expect(next[0]?.score).toBe(0);
    expect(sanitizeDecisionForViewer(decision, "usr_gee").note).toBeUndefined();
    expect(sanitizeDecisionForViewer(decision, "usr_mike").note).toBe(PRIVATE_NOTE);
    expect(publicRejectionCopy(decision, "Other Place")).toContain("doesn't work for everyone");
    expect(publicRejectionCopy(decision, "Other Place")).not.toContain(PRIVATE_NOTE);
    expect(JSON.stringify(decisionsForAgentContext([decision]))).not.toContain(PRIVATE_NOTE);
  });

  it("lets a participant change or remove a rejection", () => {
    const rejected = applyDecisionsToEvaluations(
      [evaluation("res_other", "usr_mike")],
      [
        {
          id: "rdc_4",
          eventId: "evt_a",
          restaurantId: "res_other",
          userId: "usr_mike",
          decision: "reject",
          visibility: "event",
          createdAt: "2026-09-16T12:00:00.000Z"
        }
      ]
    );
    const cleared = applyDecisionsToEvaluations(
      [evaluation("res_other", "usr_mike")],
      [
        {
          id: "rdc_4",
          eventId: "evt_a",
          restaurantId: "res_other",
          userId: "usr_mike",
          decision: "neutral",
          visibility: "event",
          createdAt: "2026-09-16T12:00:00.000Z",
          updatedAt: "2026-09-16T13:00:00.000Z"
        }
      ]
    );
    expect(rejected[0]?.rejected).toBe(true);
    expect(cleared[0]?.rejected).toBe(false);
  });
});

describe("event chat and preference detection", () => {
  it("authorizes members and denies outsiders", () => {
    const event = {
      type: "event" as const,
      eventId: "evt_a",
      ownerId: "usr_gee",
      memberIds: ["usr_gee", "usr_sarah"]
    };
    expect(
      authorize({
        principal: createUserPrincipal("usr_sarah"),
        action: "chat.write",
        resource: event
      }).allowed
    ).toBe(true);
    expect(
      authorize({
        principal: createUserPrincipal("usr_stranger"),
        action: "chat.write",
        resource: event
      }).allowed
    ).toBe(false);
    expect(
      authorize({
        principal: createPersonalAgentPrincipal({ userId: "usr_sarah", eventId: "evt_b" }),
        action: "chat.read",
        resource: event
      }).allowed
    ).toBe(false);
  });

  it("detects a cuisine preference without persisting until confirmation", () => {
    const detected = detectPreferenceFromChat({
      eventId: "evt_a",
      userId: "usr_sarah",
      sourceMessageId: "msg_1",
      text: "I'd really rather have Italian."
    });
    expect(detected?.category).toBe("cuisine");
    expect(detected?.value).toEqual({ cuisines: ["italian"] });
    const prompt = newPreferencePrompt(detected!);
    expect(prompt.status).toBe("pending");
    expect(prompt.question).toMatch(/Italian/i);
  });

  it("does not treat ordinary chat as a structured preference", () => {
    expect(
      detectPreferenceFromChat({
        eventId: "evt_a",
        userId: "usr_sarah",
        sourceMessageId: "msg_2",
        text: "The lighting in that photo looks nice."
      })
    ).toBeUndefined();
  });

  it("redacts deleted chat without removing structured decisions", () => {
    const decision: RestaurantDecision = {
      id: "rdc_5",
      eventId: "evt_a",
      restaurantId: "res_coopers",
      userId: "usr_gee",
      decision: "prefer",
      visibility: "event",
      createdAt: "2026-09-16T12:00:00.000Z"
    };
    const deleted = sanitizeChatMessage({
      id: "msg_3",
      eventId: "evt_a",
      sender: { type: "user", userId: "usr_gee" },
      messageType: "text",
      text: "Prefer Cooper's Hawk",
      relatedRestaurantId: "res_coopers",
      relatedActionId: decision.id,
      createdAt: "2026-09-16T12:00:00.000Z",
      deletedAt: "2026-09-16T12:05:00.000Z"
    });
    expect(deleted.text).toBeUndefined();
    expect(deleted.relatedActionId).toBe(decision.id);
    expect(decision.decision).toBe("prefer");
  });
});

describe("privacy boundaries", () => {
  it("keeps a private rejection note out of public chat, other viewers, agents, and logs", () => {
    const decision: RestaurantDecision = {
      id: "rdc_priv",
      eventId: "evt_a",
      restaurantId: "res_other",
      userId: "usr_mike",
      decision: "reject",
      reasonCategory: "previous-experience",
      note: PRIVATE_NOTE,
      visibility: "private",
      createdAt: "2026-09-16T12:00:00.000Z"
    };
    const publicChat = {
      id: "msg_sys",
      eventId: "evt_a",
      sender: { type: "council" as const },
      messageType: "restaurant-decision" as const,
      text: publicRejectionCopy(decision, "Other Place"),
      createdAt: "2026-09-16T12:00:00.000Z"
    };
    const otherApi = sanitizeDecisionForViewer(decision, "usr_gee");
    const negotiatorContext = JSON.stringify(decisionsForAgentContext([decision]));
    const otherAgent = authorize({
      principal: createPersonalAgentPrincipal({ userId: "usr_gee", eventId: "evt_a" }),
      action: "preference.private.read",
      resource: { type: "preference", userId: "usr_mike", eventId: "evt_a", visibility: "PRIVATE" }
    });
    const metric = JSON.stringify({ metric: "restaurant_rejected", visibility: decision.visibility });
    expect(publicChat.text).not.toContain(PRIVATE_NOTE);
    expect(otherApi.note).toBeUndefined();
    expect(otherApi.reasonCategory).toBeUndefined();
    expect(negotiatorContext).not.toContain(PRIVATE_NOTE);
    expect(otherAgent.allowed).toBe(false);
    expect(metric).not.toContain(PRIVATE_NOTE);
    expect(createNegotiatorPrincipal("evt_a").eventId).toBe("evt_a");
  });

  it("hides private human evidence from other participants", () => {
    const evidence: HumanEvidence = {
      id: "hev_priv",
      eventId: "evt_a",
      restaurantId: "res_coopers",
      requirementType: "dietary",
      requirementValue: "dairy-free",
      providedByUserId: "usr_gee",
      method: "phone",
      result: "supports",
      notes: PRIVATE_NOTE,
      verifiedAt: "2026-09-16T15:04:00.000Z",
      visibility: "private"
    };
    expect(sanitizeEvidenceForViewer(evidence, "usr_mike")).toBeNull();
    expect(sanitizeEvidenceForViewer(evidence, "usr_gee")?.notes).toBe(PRIVATE_NOTE);
    const merged = mergeHumanEvidenceIntoCandidates(snapshot(), [evidence]);
    expect(JSON.stringify(merged.candidates[0]?.dietaryAssessments)).not.toContain(PRIVATE_NOTE);
  });
});

describe("council re-evaluation", () => {
  it("re-ranks after human evidence and a private reject without leaking the private reason", async () => {
    const evidence: HumanEvidence = {
      id: "hev_2",
      eventId: "evt_a",
      restaurantId: "res_coopers",
      requirementType: "dietary",
      requirementValue: "dairy-free",
      providedByUserId: "usr_gee",
      method: "phone",
      result: "supports",
      notes: "They can accommodate dairy-free entrees.",
      verifiedAt: "2026-09-16T15:04:00.000Z",
      visibility: "event"
    };
    const reject: RestaurantDecision = {
      id: "rdc_6",
      eventId: "evt_a",
      restaurantId: "res_other",
      userId: "usr_mike",
      decision: "reject",
      note: PRIVATE_NOTE,
      visibility: "private",
      createdAt: "2026-09-16T15:05:00.000Z"
    };
    const next = await reevaluateCouncil({
      snapshot: snapshot(),
      evidence: [evidence],
      decisions: [reject]
    });
    const coopers = next.candidates.find((item) => item.id === "res_coopers");
    expect(coopers?.dietaryAssessments?.[0]?.status).toBe("confirmed");
    expect(next.evaluations.some((item) => item.candidateId === "res_other" && item.rejected)).toBe(true);
    expect(next.recommendations.some((item) => item.candidate.id === "res_other" && !item.rejected)).toBe(
      false
    );
    expect(JSON.stringify(next)).not.toContain(PRIVATE_NOTE);
    expect(JSON.stringify(next.recommendations)).not.toContain(PRIVATE_NOTE);
    expect(next.events.some((item) => item.type === "collaboration.updated")).toBe(true);
    expect(
      candidateStatus({
        candidate: coopers!,
        evaluations: next.evaluations,
        tasks: [],
        finalistIds: next.recommendations.filter((item) => !item.rejected).map((item) => item.candidate.id)
      })
    ).toBe("finalist");
  });

  it("does not treat a dislike as eliminating the restaurant", async () => {
    const next = await reevaluateCouncil({
      snapshot: snapshot(),
      evidence: [],
      decisions: [
        {
          id: "rdc_7",
          eventId: "evt_a",
          restaurantId: "res_coopers",
          userId: "usr_mike",
          decision: "dislike",
          visibility: "event",
          createdAt: "2026-09-16T15:05:00.000Z"
        }
      ]
    });
    const coopers = next.recommendations.find((item) => item.candidate.id === "res_coopers");
    expect(coopers?.rejected).toBe(false);
  });

  it("keeps recommendation photos after a dairy-free verification re-evaluation", async () => {
    const photos = [
      {
        provider: "google" as const,
        providerPhotoId: "places/ChIJ/photos/coopers",
        width: 1600,
        height: 900
      }
    ];
    const base = snapshot();
    base.recommendations = [
      {
        candidate: { ...base.candidates[0]!, photos },
        councilScore: 82,
        evaluations: base.evaluations.filter((item) => item.candidateId === "res_coopers"),
        explanations: ["Strong match for the group"],
        rejected: false
      }
    ];
    base.candidates = base.candidates.map((candidate) =>
      candidate.id === "res_coopers" ? { ...candidate, photos: undefined } : candidate
    );
    const next = await reevaluateCouncil({
      snapshot: base,
      evidence: [
        {
          id: "hev_photo",
          eventId: "evt_a",
          restaurantId: "res_coopers",
          requirementType: "dietary",
          requirementValue: "dairy-free",
          providedByUserId: "usr_gee",
          method: "phone",
          result: "supports",
          verifiedAt: "2026-09-16T15:04:00.000Z",
          visibility: "event"
        }
      ],
      decisions: [
        {
          id: "rdc_approve",
          eventId: "evt_a",
          restaurantId: "res_coopers",
          userId: "usr_gee",
          decision: "approve",
          visibility: "event",
          createdAt: "2026-09-16T15:05:00.000Z"
        }
      ]
    });
    const recommended = next.recommendations.find((item) => item.candidate.id === "res_coopers");
    expect(recommended?.candidate.photos?.[0]?.providerPhotoId).toBe("places/ChIJ/photos/coopers");
  });
});

describe("restaurant media merge", () => {
  it("keeps known photos when a later candidate copy has none", () => {
    const base = candidate("res_coopers");
    const merged = mergeRestaurantMedia(
      { ...base, photos: undefined },
      {
        ...base,
        photos: [
          {
            provider: "google",
            providerPhotoId: "places/ChIJ/photos/keep",
            width: 1600,
            height: 900
          }
        ]
      }
    );
    expect(merged.photos?.[0]?.providerPhotoId).toBe("places/ChIJ/photos/keep");
  });
});
