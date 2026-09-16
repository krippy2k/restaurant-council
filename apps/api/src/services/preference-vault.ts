import { assertAuthorized, authorize, type Principal } from "@rc/auth";
import type { Preference, PrivatePreferenceRecord } from "@rc/domain";
import { createId, nowIso } from "@rc/shared";
import type { Database } from "../db/database.ts";

export class D1PreferenceVault {
  constructor(private readonly db: Database) {}

  async readPrivate(
    principal: Principal,
    userId: string,
    eventId: string
  ): Promise<PrivatePreferenceRecord[]> {
    assertAuthorized({
      principal,
      action: "preference.private.read",
      resource: {
        type: "preference",
        userId,
        eventId,
        visibility: "PRIVATE"
      }
    });
    return this.db.readVault(userId, eventId);
  }

  tryReadPrivate(
    principal: Principal,
    userId: string,
    eventId: string
  ): { allowed: false; decision: ReturnType<typeof authorize> } | { allowed: true } {
    const decision = authorize({
      principal,
      action: "preference.private.read",
      resource: {
        type: "preference",
        userId,
        eventId,
        visibility: "PRIVATE"
      }
    });
    if (!decision.allowed) return { allowed: false, decision };
    return { allowed: true };
  }

  async upsertPrivate(
    principal: Principal,
    input: {
      preference: Preference;
      sourceText?: string;
      structuredValue: Record<string, unknown>;
    }
  ): Promise<PrivatePreferenceRecord> {
    assertAuthorized({
      principal,
      action: "preference.private.write",
      resource: {
        type: "preference",
        userId: input.preference.userId,
        eventId: input.preference.eventId,
        visibility: "PRIVATE"
      }
    });
    const existing = await this.db.getVaultByPreferenceId(input.preference.id);
    const record: PrivatePreferenceRecord = {
      id: existing?.id ?? createId("pvt"),
      preferenceId: input.preference.id,
      userId: input.preference.userId,
      eventId: input.preference.eventId,
      category: input.preference.category,
      sourceText: input.sourceText,
      structuredValue: input.structuredValue,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso()
    };
    await this.db.upsertVault(record);
    return record;
  }
}
