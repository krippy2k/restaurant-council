import { describe, expect, it } from "vitest";
import { isStaleCouncilLock } from "@rc/orchestration";

describe("council run lock", () => {
  it("keeps a fresh in-progress lock", () => {
    expect(
      isStaleCouncilLock({
        running: true,
        runningStartedAt: 1_000,
        snapshotStatus: "EVALUATING",
        now: 1_000 + 30_000
      })
    ).toBe(false);
  });

  it("clears a lock left behind after a reload or completed run", () => {
    expect(isStaleCouncilLock({ running: true, snapshotStatus: "SEARCHING" })).toBe(true);
    expect(
      isStaleCouncilLock({
        running: true,
        runningStartedAt: 1,
        snapshotStatus: "COMPLETE",
        now: 2
      })
    ).toBe(true);
    expect(
      isStaleCouncilLock({
        running: true,
        runningStartedAt: 1,
        snapshotStatus: "EVALUATING",
        now: 1 + 11 * 60 * 1000
      })
    ).toBe(true);
  });
});
