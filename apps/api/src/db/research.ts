import type { AgentInvocation, RestaurantResearchAnswer } from "@rc/protocol";
import type { CachedEvidence, ResearchCache } from "@rc/tools";
import { nowIso } from "@rc/shared";

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export class ResearchStore implements ResearchCache {
  constructor(private readonly db: D1Database) {}

  async insertInvocation(invocation: AgentInvocation): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agent_invocations (
          id, event_id, user_id, agent_id, source_message_id, response_message_id, visibility, status,
          query, resolved_restaurant_ids_json, answer_json, started_at, completed_at, error_code, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        invocation.id,
        invocation.eventId,
        invocation.userId,
        invocation.agentId,
        invocation.sourceMessageId,
        invocation.responseMessageId ?? null,
        invocation.visibility,
        invocation.status,
        invocation.query,
        invocation.resolvedRestaurantIds ? json(invocation.resolvedRestaurantIds) : null,
        invocation.answer ? json(invocation.answer) : null,
        invocation.startedAt ?? null,
        invocation.completedAt ?? null,
        invocation.errorCode ?? null,
        invocation.errorMessage ?? null,
        nowIso()
      )
      .run();
  }

  async updateInvocation(invocation: AgentInvocation): Promise<void> {
    await this.db
      .prepare(
        `UPDATE agent_invocations SET
          response_message_id = ?, status = ?, resolved_restaurant_ids_json = ?, answer_json = ?,
          started_at = ?, completed_at = ?, error_code = ?, error_message = ?
         WHERE id = ? AND event_id = ?`
      )
      .bind(
        invocation.responseMessageId ?? null,
        invocation.status,
        invocation.resolvedRestaurantIds ? json(invocation.resolvedRestaurantIds) : null,
        invocation.answer ? json(invocation.answer) : null,
        invocation.startedAt ?? null,
        invocation.completedAt ?? null,
        invocation.errorCode ?? null,
        invocation.errorMessage ?? null,
        invocation.id,
        invocation.eventId
      )
      .run();
  }

  async getInvocation(eventId: string, invocationId: string): Promise<AgentInvocation | null> {
    const row = await this.db
      .prepare("SELECT * FROM agent_invocations WHERE event_id = ? AND id = ?")
      .bind(eventId, invocationId)
      .first();
    return row ? mapInvocation(row as Record<string, unknown>) : null;
  }

  async listInvocations(eventId: string, userId?: string): Promise<AgentInvocation[]> {
    const result = userId
      ? await this.db
          .prepare(
            `SELECT * FROM agent_invocations WHERE event_id = ? AND (visibility = 'event' OR user_id = ?)
             ORDER BY created_at ASC`
          )
          .bind(eventId, userId)
          .all()
      : await this.db
          .prepare("SELECT * FROM agent_invocations WHERE event_id = ? AND visibility = 'event' ORDER BY created_at ASC")
          .bind(eventId)
          .all();
    return (result.results as Record<string, unknown>[]).map(mapInvocation);
  }

  async get(key: string): Promise<CachedEvidence | null> {
    const row = await this.db
      .prepare("SELECT * FROM restaurant_research_cache WHERE cache_key = ?")
      .bind(key)
      .first();
    if (!row) return null;
    const record = row as Record<string, unknown>;
    return {
      key: String(record.cache_key),
      payload: parseJson(record.payload_json, null),
      retrievedAt: String(record.retrieved_at),
      expiresAt: String(record.expires_at)
    };
  }

  async set(entry: CachedEvidence): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO restaurant_research_cache (cache_key, payload_json, retrieved_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           retrieved_at = excluded.retrieved_at,
           expires_at = excluded.expires_at`
      )
      .bind(entry.key, json(entry.payload), entry.retrievedAt, entry.expiresAt)
      .run();
  }
}

function mapInvocation(row: Record<string, unknown>): AgentInvocation {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    userId: String(row.user_id),
    agentId: String(row.agent_id),
    sourceMessageId: String(row.source_message_id),
    responseMessageId: row.response_message_id ? String(row.response_message_id) : undefined,
    visibility: row.visibility as AgentInvocation["visibility"],
    status: row.status as AgentInvocation["status"],
    query: String(row.query),
    resolvedRestaurantIds: row.resolved_restaurant_ids_json
      ? parseJson(row.resolved_restaurant_ids_json, [])
      : undefined,
    answer: row.answer_json ? (parseJson(row.answer_json, undefined) as RestaurantResearchAnswer | undefined) : undefined,
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined
  };
}

