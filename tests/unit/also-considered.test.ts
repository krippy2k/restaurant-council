import { describe, expect, it } from "vitest";
import { whyNotRecommended } from "@rc/agents";

const restaurant = {
  id: "res_other",
  name: "Other Place",
  cuisines: ["american"],
  dietaryAssessments: [{ requirement: "dairy-free", status: "uncertain" }]
};

describe("also-considered reasons", () => {
  it("uses generic copy for a private veto", () => {
    const reasons = whyNotRecommended({
      restaurant,
      evaluations: [
        {
          participantId: "usr_mike",
          score: 0,
          label: "Constraint conflict",
          rejected: true,
          privateConflict: true
        }
      ],
      constraints: [],
      topScores: [84],
      publicReject: true
    });
    expect(reasons[0]).toBe("This restaurant doesn't work for everyone.");
    expect(reasons.join(" ")).not.toContain("hated");
  });

  it("explains uncertain dietary fit and a lower council score", () => {
    const reasons = whyNotRecommended({
      restaurant,
      evaluations: [
        { participantId: "usr_gee", score: 64, label: "Acceptable", rejected: false }
      ],
      constraints: [],
      topScores: [86]
    });
    expect(reasons).toContain("dairy free accommodation is still uncertain.");
    expect(reasons.some((item) => item.includes("Lower Council match"))).toBe(true);
  });

  it("falls back when the restaurant is merely ranked lower", () => {
    const reasons = whyNotRecommended({
      restaurant: { ...restaurant, dietaryAssessments: [] },
      evaluations: [
        { participantId: "usr_gee", score: 80, label: "Good match", rejected: false }
      ],
      constraints: [],
      topScores: [82]
    });
    expect(reasons).toEqual(["A solid option, but the Council ranked other restaurants higher."]);
  });
});
