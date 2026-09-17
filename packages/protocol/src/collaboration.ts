import { z } from "zod";
import { ResearchResultCardSchema, VerificationOfferSchema } from "./research.ts";

export const VerificationMethodSchema = z.enum(["phone", "in-person", "email", "website", "other"]);
export const VerificationStatusSchema = z.enum(["open", "claimed", "completed", "cancelled"]);
export const HumanEvidenceResultSchema = z.enum(["supports", "contradicts", "uncertain"]);
export const DecisionVisibilitySchema = z.enum(["event", "private"]);
export const RestaurantDecisionTypeSchema = z.enum([
  "approve",
  "prefer",
  "neutral",
  "dislike",
  "reject"
]);
export const CandidateStatusSchema = z.enum([
  "active",
  "needs-verification",
  "rejected",
  "eliminated",
  "finalist",
  "selected"
]);
export const ChatSenderTypeSchema = z.enum(["user", "council", "system", "agent"]);
export const ChatMessageTypeSchema = z.enum([
  "text",
  "agent-request",
  "agent-response",
  "council-update",
  "verification-update",
  "restaurant-decision",
  "preference-confirmation"
]);
export const CouncilActionTypeSchema = z.enum([
  "verification-requested",
  "verification-claimed",
  "verification-released",
  "verification-completed",
  "restaurant-approved",
  "restaurant-preferred",
  "restaurant-disliked",
  "restaurant-rejected",
  "restaurant-decision-changed",
  "preference-confirmed",
  "preference-declined",
  "candidate-reconsidered"
]);
export const RejectionReasonCategorySchema = z.enum([
  "dietary",
  "price",
  "distance",
  "cuisine",
  "been-before",
  "previous-experience",
  "accessibility",
  "other"
]);

export const VerificationTaskSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  restaurantId: z.string(),
  requirementType: z.string().min(1).max(40),
  requirementValue: z.unknown().optional(),
  question: z.string().min(1).max(280),
  status: VerificationStatusSchema,
  createdBy: z.discriminatedUnion("type", [
    z.object({ type: z.literal("system") }),
    z.object({ type: z.literal("user"), userId: z.string() })
  ]),
  assignedToUserId: z.string().optional(),
  createdAt: z.string(),
  claimedAt: z.string().optional(),
  completedAt: z.string().optional()
});

export const HumanEvidenceSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  restaurantId: z.string(),
  requirementType: z.string().min(1).max(40),
  requirementValue: z.unknown().optional(),
  providedByUserId: z.string(),
  method: VerificationMethodSchema,
  result: HumanEvidenceResultSchema,
  notes: z.string().max(500).optional(),
  verifiedAt: z.string(),
  visibility: DecisionVisibilitySchema.default("event")
});

export const RestaurantDecisionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  restaurantId: z.string(),
  userId: z.string(),
  decision: RestaurantDecisionTypeSchema,
  reasonCategory: RejectionReasonCategorySchema.optional(),
  note: z.string().max(400).optional(),
  visibility: DecisionVisibilitySchema,
  createdAt: z.string(),
  updatedAt: z.string().optional()
});

export const EventChatMessageSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  sender: z.discriminatedUnion("type", [
    z.object({ type: z.literal("user"), userId: z.string() }),
    z.object({ type: z.literal("agent"), agentId: z.string() }),
    z.object({ type: z.literal("council") }),
    z.object({ type: z.literal("system") })
  ]),
  messageType: ChatMessageTypeSchema,
  text: z.string().max(2000).optional(),
  relatedRestaurantId: z.string().optional(),
  relatedRestaurantIds: z.array(z.string()).optional(),
  relatedActionId: z.string().optional(),
  relatedAgentInvocationId: z.string().optional(),
  cards: z.array(ResearchResultCardSchema).optional(),
  offerVerification: VerificationOfferSchema.optional(),
  createdAt: z.string(),
  editedAt: z.string().optional(),
  deletedAt: z.string().optional()
});

export const CouncilActionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  restaurantId: z.string().optional(),
  actorUserId: z.string().optional(),
  type: CouncilActionTypeSchema,
  visibility: DecisionVisibilitySchema,
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string()
});

export const PreferencePromptSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  sourceMessageId: z.string().optional(),
  question: z.string().max(240),
  category: z.string(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "HARD"]),
  value: z.record(z.unknown()),
  status: z.enum(["pending", "accepted", "declined"]),
  createdAt: z.string(),
  resolvedAt: z.string().optional()
});

export const CompleteVerificationInputSchema = z.object({
  result: HumanEvidenceResultSchema,
  method: VerificationMethodSchema,
  notes: z.string().max(500).optional(),
  visibility: DecisionVisibilitySchema.optional()
});

export const UpsertDecisionInputSchema = z.object({
  decision: RestaurantDecisionTypeSchema,
  reasonCategory: RejectionReasonCategorySchema.optional(),
  note: z.string().max(400).optional(),
  visibility: DecisionVisibilitySchema.default("event")
});

export const PostChatInputSchema = z.object({
  text: z.string().min(1).max(2000),
  relatedRestaurantId: z.string().optional()
});

export type VerificationMethod = z.infer<typeof VerificationMethodSchema>;
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type HumanEvidenceResult = z.infer<typeof HumanEvidenceResultSchema>;
export type DecisionVisibility = z.infer<typeof DecisionVisibilitySchema>;
export type RestaurantDecisionType = z.infer<typeof RestaurantDecisionTypeSchema>;
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;
export type VerificationTask = z.infer<typeof VerificationTaskSchema>;
export type HumanEvidence = z.infer<typeof HumanEvidenceSchema>;
export type RestaurantDecision = z.infer<typeof RestaurantDecisionSchema>;
export type EventChatMessage = z.infer<typeof EventChatMessageSchema>;
export type CouncilAction = z.infer<typeof CouncilActionSchema>;
export type PreferencePrompt = z.infer<typeof PreferencePromptSchema>;
export type CompleteVerificationInput = z.infer<typeof CompleteVerificationInputSchema>;
export type UpsertDecisionInput = z.infer<typeof UpsertDecisionInputSchema>;

export function sanitizeDecisionForViewer(
  decision: RestaurantDecision,
  viewerId: string
): RestaurantDecision {
  if (decision.visibility === "event" || decision.userId === viewerId) return decision;
  return {
    ...decision,
    note: undefined,
    reasonCategory: undefined
  };
}

export function sanitizeEvidenceForViewer(
  evidence: HumanEvidence,
  viewerId: string
): HumanEvidence | null {
  if (evidence.visibility === "event" || evidence.providedByUserId === viewerId) return evidence;
  return null;
}

export function sanitizeChatMessage(message: EventChatMessage): EventChatMessage {
  if (!message.deletedAt) return message;
  return {
    ...message,
    text: undefined,
    cards: undefined,
    offerVerification: undefined
  };
}

export function decisionsForAgentContext(decisions: RestaurantDecision[]): Array<{
  restaurantId: string;
  userId: string;
  decision: RestaurantDecisionType;
  visibility: DecisionVisibility;
}> {
  return decisions.map((item) => ({
    restaurantId: item.restaurantId,
    userId: item.userId,
    decision: item.decision,
    visibility: item.visibility
  }));
}

export function publicRejectionCopy(decision: RestaurantDecision, restaurantName: string): string {
  if (decision.decision !== "reject") return "";
  if (decision.visibility === "private") {
    return "That restaurant doesn't work for everyone, so I've removed it from the finalists.";
  }
  const reason = decision.reasonCategory
    ? ` Reason: ${labelReason(decision.reasonCategory)}.`
    : "";
  return `${restaurantName} was rejected.${reason}`.trim();
}

export function labelReason(category: string): string {
  const labels: Record<string, string> = {
    dietary: "Dietary concern",
    price: "Too expensive",
    distance: "Too far away",
    cuisine: "Don't like the cuisine",
    "been-before": "Been there before",
    "previous-experience": "Bad previous experience",
    accessibility: "Accessibility concern",
    other: "Other"
  };
  return labels[category] ?? category;
}

export function suggestedVerificationQuestion(
  requirementType: string,
  requirementValue: unknown,
  strict = false
): string {
  const value =
    typeof requirementValue === "string"
      ? requirementValue
      : requirementValue && typeof requirementValue === "object" && "requirement" in requirementValue
        ? String((requirementValue as { requirement: string }).requirement)
        : "this requirement";
  if (requirementType === "dietary" || value.includes("free") || value === "vegan" || value === "vegetarian") {
    if (strict || value === "dairy-free") {
      return strict
        ? `Do you have dishes prepared without ${value.replace(/-free$/, "")}, and can you tell me whether your kitchen can accommodate a strict ${value} restriction?`
        : `Do you have ${value} meal options, and can they be prepared without ${value.replace(/-free$/, "")}?`;
    }
    return `Can this restaurant accommodate ${value} meals?`;
  }
  if (requirementType === "opening-hours") {
    return "Will you be open at our reservation time and stay open for at least an hour after we arrive?";
  }
  if (requirementType === "party-size") return `Can they seat a party of ${String(requirementValue)}?`;
  if (requirementType === "kid-friendly") return "Do they have high chairs?";
  if (requirementType === "accessibility") return "Can they accommodate a wheelchair?";
  if (requirementType === "reservation") return `Do they accept reservations at ${String(requirementValue)}?`;
  return `Can this restaurant accommodate ${value}?`;
}
