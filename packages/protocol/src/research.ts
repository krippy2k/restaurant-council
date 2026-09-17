import { z } from "zod";

export const ResearchConfidenceSchema = z.enum(["confirmed", "likely", "uncertain", "conflicting"]);
export type ResearchConfidence = z.infer<typeof ResearchConfidenceSchema>;

export const RestaurantEvidenceSourceTypeSchema = z.enum([
  "official-menu",
  "official-website",
  "official-ordering",
  "structured-provider",
  "reservation-provider",
  "third-party-menu",
  "review",
  "web",
  "human-verification"
]);
export type RestaurantEvidenceSourceType = z.infer<typeof RestaurantEvidenceSourceTypeSchema>;

export const RestaurantEvidenceSchema = z.object({
  id: z.string(),
  restaurantId: z.string(),
  sourceType: RestaurantEvidenceSourceTypeSchema,
  sourceName: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  summary: z.string().max(800),
  retrievedAt: z.string(),
  publishedAt: z.string().optional()
});
export type RestaurantEvidence = z.infer<typeof RestaurantEvidenceSchema>;

export const MenuItemEvidenceSchema = z.object({
  id: z.string(),
  restaurantId: z.string(),
  name: z.string().min(1).max(160),
  description: z.string().max(400).optional(),
  price: z.number().positive().optional(),
  currency: z.string().min(3).max(3).optional(),
  menuSection: z.string().max(80).optional(),
  sourceUrl: z.string().url().optional(),
  sourceType: z.enum([
    "official-menu",
    "official-website",
    "official-ordering",
    "structured-provider",
    "third-party-menu",
    "review"
  ]),
  retrievedAt: z.string(),
  confidence: ResearchConfidenceSchema
});
export type MenuItemEvidence = z.infer<typeof MenuItemEvidenceSchema>;

export const MenuItemCardSchema = z.object({
  type: z.literal("menu-item"),
  restaurantId: z.string(),
  item: z.object({
    name: z.string(),
    description: z.string().optional(),
    price: z.number().positive().optional(),
    currency: z.string().optional()
  }),
  evidenceId: z.string(),
  sourceName: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  checkedAt: z.string().optional()
});

export const ReservationLinkCardSchema = z.object({
  type: z.literal("reservation-link"),
  restaurantId: z.string(),
  provider: z.string(),
  url: z.string().url(),
  label: z.string(),
  evidenceId: z.string()
});

export const FactCardSchema = z.object({
  type: z.literal("fact"),
  restaurantId: z.string(),
  label: z.string(),
  value: z.string(),
  evidenceId: z.string().optional(),
  sourceName: z.string().optional()
});

export const LinkCardSchema = z.object({
  type: z.literal("link"),
  restaurantId: z.string(),
  url: z.string().url(),
  label: z.string(),
  sourceName: z.string().optional(),
  evidenceId: z.string().optional()
});

export const ResearchResultCardSchema = z.discriminatedUnion("type", [
  MenuItemCardSchema,
  ReservationLinkCardSchema,
  FactCardSchema,
  LinkCardSchema
]);
export type ResearchResultCard = z.infer<typeof ResearchResultCardSchema>;
export type MenuItemCard = z.infer<typeof MenuItemCardSchema>;
export type ReservationLinkCard = z.infer<typeof ReservationLinkCardSchema>;
export type LinkCard = z.infer<typeof LinkCardSchema>;

export const AgentMentionSchema = z.object({
  agentId: z.string(),
  mention: z.string(),
  query: z.string()
});
export type AgentMention = z.infer<typeof AgentMentionSchema>;

export const AgentInvocationVisibilitySchema = z.enum(["event", "private"]);
export type AgentInvocationVisibility = z.infer<typeof AgentInvocationVisibilitySchema>;

export const AgentInvocationStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
]);
export type AgentInvocationStatus = z.infer<typeof AgentInvocationStatusSchema>;

export const VerificationOfferSchema = z.object({
  restaurantId: z.string(),
  question: z.string().min(1).max(280),
  requirementType: z.string().min(1).max(40),
  requirementValue: z.unknown().optional()
});
export type VerificationOffer = z.infer<typeof VerificationOfferSchema>;

export const RestaurantResearchAnswerSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  requestingUserId: z.string(),
  question: z.string(),
  answer: z.string().max(2000),
  confidence: ResearchConfidenceSchema,
  restaurantIds: z.array(z.string()),
  evidence: z.array(RestaurantEvidenceSchema),
  cards: z.array(ResearchResultCardSchema).optional(),
  offerVerification: VerificationOfferSchema.optional(),
  progress: z.array(z.string()).optional(),
  checkedAt: z.string()
});
export type RestaurantResearchAnswer = z.infer<typeof RestaurantResearchAnswerSchema>;

export const AgentInvocationSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  agentId: z.string(),
  sourceMessageId: z.string(),
  responseMessageId: z.string().optional(),
  visibility: AgentInvocationVisibilitySchema,
  status: AgentInvocationStatusSchema,
  query: z.string(),
  resolvedRestaurantIds: z.array(z.string()).optional(),
  answer: RestaurantResearchAnswerSchema.optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional()
});
export type AgentInvocation = z.infer<typeof AgentInvocationSchema>;

export const ToolExecutionContextSchema = z.object({
  eventId: z.string(),
  requestingUserId: z.string(),
  agentId: z.string(),
  correlationId: z.string(),
  authorized: z.boolean()
});
export type ToolExecutionContext = z.infer<typeof ToolExecutionContextSchema>;

export const SOURCE_RANK: Record<RestaurantEvidenceSourceType, number> = {
  "official-menu": 1,
  "official-website": 2,
  "official-ordering": 3,
  "structured-provider": 4,
  "reservation-provider": 4,
  "human-verification": 4,
  "third-party-menu": 5,
  review: 6,
  web: 7
};

export function rankEvidenceSource(sourceType: RestaurantEvidenceSourceType): number {
  return SOURCE_RANK[sourceType] ?? 9;
}

export function isSafeHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value.trim());
}

export function sanitizeResearchCards(cards: ResearchResultCard[] | undefined): ResearchResultCard[] {
  if (!cards?.length) return [];
  return cards.filter((card) => {
    if (card.type === "reservation-link" || card.type === "link") return isSafeHttpUrl(card.url);
    if (card.type === "menu-item") return !card.sourceUrl || isSafeHttpUrl(card.sourceUrl);
    return true;
  });
}
