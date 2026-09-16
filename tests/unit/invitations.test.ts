import { hashToken, isExpired } from "@rc/shared";
import { describe, expect, it } from "vitest";

describe("invitation tokens", () => {
  it("hashes tokens with SHA-256 hex", async () => {
    const hash = await hashToken("abc123");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
    expect(hash).not.toBe("abc123");
    expect(await hashToken("abc123")).toBe(hash);
    expect(await hashToken("abc124")).not.toBe(hash);
  });

  it("treats consumed and expired invitations as invalid timestamps", () => {
    expect(isExpired("2000-01-01T00:00:00.000Z")).toBe(true);
    expect(isExpired("2999-01-01T00:00:00.000Z")).toBe(false);
  });
});
