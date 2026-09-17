import type {
  CouncilAction,
  EventChatMessage,
  HumanEvidence,
  PreferencePrompt,
  RestaurantDecision,
  VerificationTask
} from "@rc/protocol";
import { createId, nowIso } from "@rc/shared";

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

export class CollaborationStore {
  constructor(private readonly db: D1Database) {}

  async listChat(eventId: string): Promise<EventChatMessage[]> {
    const result = await this.db
      .prepare("SELECT * FROM event_chat_messages WHERE event_id = ? ORDER BY created_at ASC")
      .bind(eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapChat);
  }

  async insertChat(message: EventChatMessage): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO event_chat_messages (
          id, event_id, sender_type, sender_user_id, sender_agent_id, message_type, text,
          related_restaurant_id, related_restaurant_ids_json, related_action_id, related_agent_invocation_id,
          cards_json, offer_verification_json, created_at, edited_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        message.id,
        message.eventId,
        message.sender.type,
        message.sender.type === "user" ? message.sender.userId : null,
        message.sender.type === "agent" ? message.sender.agentId : null,
        message.messageType,
        message.text ?? null,
        message.relatedRestaurantId ?? message.relatedRestaurantIds?.[0] ?? null,
        message.relatedRestaurantIds ? json(message.relatedRestaurantIds) : null,
        message.relatedActionId ?? null,
        message.relatedAgentInvocationId ?? null,
        message.cards ? json(message.cards) : null,
        message.offerVerification ? json(message.offerVerification) : null,
        message.createdAt,
        message.editedAt ?? null,
        message.deletedAt ?? null
      )
      .run();
  }

  async updateChat(message: EventChatMessage): Promise<void> {
    await this.db
      .prepare(
        `UPDATE event_chat_messages SET
          text = ?, edited_at = ?, deleted_at = ?, related_restaurant_id = ?, related_restaurant_ids_json = ?,
          related_agent_invocation_id = ?, cards_json = ?, offer_verification_json = ?, message_type = ?
         WHERE id = ? AND event_id = ?`
      )
      .bind(
        message.text ?? null,
        message.editedAt ?? null,
        message.deletedAt ?? null,
        message.relatedRestaurantId ?? message.relatedRestaurantIds?.[0] ?? null,
        message.relatedRestaurantIds ? json(message.relatedRestaurantIds) : null,
        message.relatedAgentInvocationId ?? null,
        message.cards ? json(message.cards) : null,
        message.offerVerification ? json(message.offerVerification) : null,
        message.messageType,
        message.id,
        message.eventId
      )
      .run();
  }

  async getChat(eventId: string, messageId: string): Promise<EventChatMessage | null> {
    const row = await this.db
      .prepare("SELECT * FROM event_chat_messages WHERE event_id = ? AND id = ?")
      .bind(eventId, messageId)
      .first();
    return row ? mapChat(row as Record<string, unknown>) : null;
  }

  async listTasks(eventId: string): Promise<VerificationTask[]> {
    const result = await this.db
      .prepare("SELECT * FROM verification_tasks WHERE event_id = ? ORDER BY created_at ASC")
      .bind(eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapTask);
  }

  async getTask(eventId: string, taskId: string): Promise<VerificationTask | null> {
    const row = await this.db
      .prepare("SELECT * FROM verification_tasks WHERE event_id = ? AND id = ?")
      .bind(eventId, taskId)
      .first();
    return row ? mapTask(row as Record<string, unknown>) : null;
  }

  async upsertTask(task: VerificationTask): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO verification_tasks (
          id, event_id, restaurant_id, requirement_type, requirement_value, question, status,
          created_by_type, created_by_user_id, assigned_to_user_id, created_at, claimed_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          assigned_to_user_id = excluded.assigned_to_user_id,
          claimed_at = excluded.claimed_at,
          completed_at = excluded.completed_at`
      )
      .bind(
        task.id,
        task.eventId,
        task.restaurantId,
        task.requirementType,
        task.requirementValue == null ? null : json(task.requirementValue),
        task.question,
        task.status,
        task.createdBy.type,
        task.createdBy.type === "user" ? task.createdBy.userId : null,
        task.assignedToUserId ?? null,
        task.createdAt,
        task.claimedAt ?? null,
        task.completedAt ?? null
      )
      .run();
  }

  async listEvidence(eventId: string): Promise<HumanEvidence[]> {
    const result = await this.db
      .prepare("SELECT * FROM human_evidence WHERE event_id = ? ORDER BY verified_at ASC")
      .bind(eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapEvidence);
  }

  async insertEvidence(evidence: HumanEvidence): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO human_evidence (
          id, event_id, restaurant_id, requirement_type, requirement_value, provided_by_user_id,
          method, result, notes, verified_at, visibility
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        evidence.id,
        evidence.eventId,
        evidence.restaurantId,
        evidence.requirementType,
        evidence.requirementValue == null ? null : json(evidence.requirementValue),
        evidence.providedByUserId,
        evidence.method,
        evidence.result,
        evidence.notes ?? null,
        evidence.verifiedAt,
        evidence.visibility
      )
      .run();
  }

  async updateEvidence(evidence: HumanEvidence): Promise<void> {
    await this.db
      .prepare(
        "UPDATE human_evidence SET result = ?, method = ?, notes = ?, verified_at = ?, visibility = ? WHERE id = ? AND event_id = ?"
      )
      .bind(
        evidence.result,
        evidence.method,
        evidence.notes ?? null,
        evidence.verifiedAt,
        evidence.visibility,
        evidence.id,
        evidence.eventId
      )
      .run();
  }

  async listDecisions(eventId: string): Promise<RestaurantDecision[]> {
    const result = await this.db
      .prepare("SELECT * FROM restaurant_decisions WHERE event_id = ?")
      .bind(eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapDecision);
  }

  async upsertDecision(decision: RestaurantDecision): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO restaurant_decisions (
          id, event_id, restaurant_id, user_id, decision, reason_category, note, visibility, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id, restaurant_id, user_id) DO UPDATE SET
          decision = excluded.decision,
          reason_category = excluded.reason_category,
          note = excluded.note,
          visibility = excluded.visibility,
          updated_at = excluded.updated_at`
      )
      .bind(
        decision.id,
        decision.eventId,
        decision.restaurantId,
        decision.userId,
        decision.decision,
        decision.reasonCategory ?? null,
        decision.note ?? null,
        decision.visibility,
        decision.createdAt,
        decision.updatedAt ?? nowIso()
      )
      .run();
  }

  async listActions(eventId: string): Promise<CouncilAction[]> {
    const result = await this.db
      .prepare("SELECT * FROM council_actions WHERE event_id = ? ORDER BY created_at ASC")
      .bind(eventId)
      .all();
    return (result.results as Record<string, unknown>[]).map(mapAction);
  }

  async insertAction(action: CouncilAction): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO council_actions (
          id, event_id, restaurant_id, actor_user_id, type, visibility, payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        action.id,
        action.eventId,
        action.restaurantId ?? null,
        action.actorUserId ?? null,
        action.type,
        action.visibility,
        json(action.payload),
        action.createdAt
      )
      .run();
  }

  async listPrompts(eventId: string, userId?: string): Promise<PreferencePrompt[]> {
    const result = userId
      ? await this.db
          .prepare("SELECT * FROM preference_prompts WHERE event_id = ? AND user_id = ? ORDER BY created_at DESC")
          .bind(eventId, userId)
          .all()
      : await this.db
          .prepare("SELECT * FROM preference_prompts WHERE event_id = ? ORDER BY created_at DESC")
          .bind(eventId)
          .all();
    return (result.results as Record<string, unknown>[]).map(mapPrompt);
  }

  async getPrompt(eventId: string, promptId: string): Promise<PreferencePrompt | null> {
    const row = await this.db
      .prepare("SELECT * FROM preference_prompts WHERE event_id = ? AND id = ?")
      .bind(eventId, promptId)
      .first();
    return row ? mapPrompt(row as Record<string, unknown>) : null;
  }

  async upsertPrompt(prompt: PreferencePrompt): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO preference_prompts (
          id, event_id, user_id, source_message_id, question, category, visibility, priority,
          value_json, status, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, resolved_at = excluded.resolved_at`
      )
      .bind(
        prompt.id,
        prompt.eventId,
        prompt.userId,
        prompt.sourceMessageId ?? null,
        prompt.question,
        prompt.category,
        prompt.visibility,
        prompt.priority,
        json(prompt.value),
        prompt.status,
        prompt.createdAt,
        prompt.resolvedAt ?? null
      )
      .run();
  }
}

function mapChat(row: Record<string, unknown>): EventChatMessage {
  const senderType = String(row.sender_type);
  const relatedRestaurantIds = row.related_restaurant_ids_json
    ? parseJson<string[]>(row.related_restaurant_ids_json, [])
    : row.related_restaurant_id
      ? [String(row.related_restaurant_id)]
      : undefined;
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    sender:
      senderType === "user"
        ? { type: "user", userId: String(row.sender_user_id) }
        : senderType === "agent"
          ? { type: "agent", agentId: String(row.sender_agent_id ?? "restaurant-research") }
          : { type: senderType as "council" | "system" },
    messageType: row.message_type as EventChatMessage["messageType"],
    text: row.text ? String(row.text) : undefined,
    relatedRestaurantId: row.related_restaurant_id ? String(row.related_restaurant_id) : relatedRestaurantIds?.[0],
    relatedRestaurantIds,
    relatedActionId: row.related_action_id ? String(row.related_action_id) : undefined,
    relatedAgentInvocationId: row.related_agent_invocation_id
      ? String(row.related_agent_invocation_id)
      : undefined,
    cards: row.cards_json ? parseJson(row.cards_json, undefined) : undefined,
    offerVerification: row.offer_verification_json ? parseJson(row.offer_verification_json, undefined) : undefined,
    createdAt: String(row.created_at),
    editedAt: row.edited_at ? String(row.edited_at) : undefined,
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined
  };
}

function mapTask(row: Record<string, unknown>): VerificationTask {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    restaurantId: String(row.restaurant_id),
    requirementType: String(row.requirement_type),
    requirementValue: row.requirement_value ? parseJson(row.requirement_value, String(row.requirement_value)) : undefined,
    question: String(row.question),
    status: row.status as VerificationTask["status"],
    createdBy:
      String(row.created_by_type) === "user"
        ? { type: "user", userId: String(row.created_by_user_id) }
        : { type: "system" },
    assignedToUserId: row.assigned_to_user_id ? String(row.assigned_to_user_id) : undefined,
    createdAt: String(row.created_at),
    claimedAt: row.claimed_at ? String(row.claimed_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined
  };
}

function mapEvidence(row: Record<string, unknown>): HumanEvidence {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    restaurantId: String(row.restaurant_id),
    requirementType: String(row.requirement_type),
    requirementValue: row.requirement_value ? parseJson(row.requirement_value, String(row.requirement_value)) : undefined,
    providedByUserId: String(row.provided_by_user_id),
    method: row.method as HumanEvidence["method"],
    result: row.result as HumanEvidence["result"],
    notes: row.notes ? String(row.notes) : undefined,
    verifiedAt: String(row.verified_at),
    visibility: row.visibility as HumanEvidence["visibility"]
  };
}

function mapDecision(row: Record<string, unknown>): RestaurantDecision {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    restaurantId: String(row.restaurant_id),
    userId: String(row.user_id),
    decision: row.decision as RestaurantDecision["decision"],
    reasonCategory: row.reason_category
      ? (String(row.reason_category) as RestaurantDecision["reasonCategory"])
      : undefined,
    note: row.note ? String(row.note) : undefined,
    visibility: row.visibility as RestaurantDecision["visibility"],
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  };
}

function mapAction(row: Record<string, unknown>): CouncilAction {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    restaurantId: row.restaurant_id ? String(row.restaurant_id) : undefined,
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : undefined,
    type: row.type as CouncilAction["type"],
    visibility: row.visibility as CouncilAction["visibility"],
    payload: parseJson(row.payload, {}),
    createdAt: String(row.created_at)
  };
}

function mapPrompt(row: Record<string, unknown>): PreferencePrompt {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    userId: String(row.user_id),
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : undefined,
    question: String(row.question),
    category: String(row.category),
    visibility: row.visibility as PreferencePrompt["visibility"],
    priority: row.priority as PreferencePrompt["priority"],
    value: parseJson(row.value_json, {}),
    status: row.status as PreferencePrompt["status"],
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined
  };
}

export function newChatMessage(
  partial: Omit<EventChatMessage, "id" | "createdAt"> & { id?: string; createdAt?: string }
): EventChatMessage {
  return {
    ...partial,
    id: partial.id ?? createId("msg"),
    createdAt: partial.createdAt ?? nowIso()
  };
}

export function newAction(
  partial: Omit<CouncilAction, "id" | "createdAt" | "payload"> & {
    id?: string;
    createdAt?: string;
    payload?: Record<string, unknown>;
  }
): CouncilAction {
  return {
    payload: {},
    ...partial,
    id: partial.id ?? createId("cact"),
    createdAt: partial.createdAt ?? nowIso()
  };
}
