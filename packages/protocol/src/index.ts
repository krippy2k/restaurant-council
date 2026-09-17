import { z } from "zod";
import {
  allergyToDietaryConstraint,
  DietaryAssessmentSchema,
  mergeDietaryConstraints,
  parseDietaryConstraints,
  type DietaryConstraint
} from "./dietary.ts";
import {
  CURRENT_HOURS_HORIZON_DAYS,
  DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES,
  EventRestaurantSearchPolicySchema,
  RestaurantHoursSchema,
  RestaurantHoursAssessmentSchema,
  RestaurantOpeningPeriodSchema,
  CandidateOpeningHoursSchema,
  defaultRestaurantSearchPolicy,
  formatHoursClock,
  formatHoursWeekday,
  hoursRejectionExplanation,
  hoursStatusCopy
} from "./hours.ts";
import {
  CouncilAgentLogSchema,
  parseLoggedPayload,
  sanitizeAgentLogEntry,
  sanitizeAgentLogValue
} from "./agent-logs.ts";

export {
  allergyToDietaryConstraint,
  dietaryConstraintOutcome,
  dietaryRequirementIds,
  KNOWN_DIETARY_REQUIREMENTS,
  mergeDietaryConstraints,
  normalizeDietaryRequirement,
  parseDietaryConstraints,
  DietaryAssessmentSchema,
  DietaryConstraintSchema,
  DietaryEvidenceSchema
} from "./dietary.ts";
export type {
  DietaryAssessment,
  DietaryAssessmentStatus,
  DietaryConstraint,
  DietaryConstraintStrength,
  DietaryEvidence,
  DietaryEvidenceRequirement,
  DietaryRequirementId,
  KnownDietaryRequirement
} from "./dietary.ts";

export {
  DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES,
  CURRENT_HOURS_HORIZON_DAYS,
  EventRestaurantSearchPolicySchema,
  RestaurantHoursSchema,
  RestaurantHoursAssessmentSchema,
  RestaurantOpeningPeriodSchema,
  CandidateOpeningHoursSchema,
  defaultRestaurantSearchPolicy,
  formatHoursClock,
  formatHoursWeekday,
  hoursRejectionExplanation,
  hoursStatusCopy
};
export type {
  EventRestaurantSearchPolicy,
  HoursAssessmentStatus,
  RestaurantHours,
  RestaurantHoursAssessment,
  RestaurantOpeningPeriod
} from "./hours.ts";

export {
  EVENT_INTENT_PARSER_VERSION,
  EventCreationIntentSchema,
  EventParserContextSchema,
  LlmEventIntentDraftSchema,
  CreateEventCommandSchema,
  stripHallucinatedLocation
} from "./event-creation.ts";
export type {
  ConstraintStrength,
  CreateEventCommand,
  EventAmbiguity,
  EventCreationIntent,
  EventLocationIntent,
  EventParserContext,
  EventRequirement,
  EventTimeIntent,
  InviteeIntent,
  LlmEventIntentDraft,
  MissingField,
  PriceConstraint
} from "./event-creation.ts";

export {
  VerificationTaskSchema,
  HumanEvidenceSchema,
  RestaurantDecisionSchema,
  EventChatMessageSchema,
  CouncilActionSchema,
  PreferencePromptSchema,
  CompleteVerificationInputSchema,
  UpsertDecisionInputSchema,
  PostChatInputSchema,
  sanitizeDecisionForViewer,
  sanitizeEvidenceForViewer,
  sanitizeChatMessage,
  publicRejectionCopy,
  suggestedVerificationQuestion,
  labelReason,
  decisionsForAgentContext
} from "./collaboration.ts";
export {
  ResearchConfidenceSchema,
  RestaurantEvidenceSchema,
  MenuItemEvidenceSchema,
  ResearchResultCardSchema,
  AgentMentionSchema,
  AgentInvocationSchema,
  RestaurantResearchAnswerSchema,
  ToolExecutionContextSchema,
  rankEvidenceSource,
  isSafeHttpUrl,
  sanitizeResearchCards,
  SOURCE_RANK
} from "./research.ts";
export type {
  ResearchConfidence,
  RestaurantEvidence,
  RestaurantEvidenceSourceType,
  MenuItemEvidence,
  ResearchResultCard,
  MenuItemCard,
  ReservationLinkCard,
  LinkCard,
  AgentMention,
  AgentInvocation,
  AgentInvocationStatus,
  AgentInvocationVisibility,
  RestaurantResearchAnswer,
  ToolExecutionContext,
  VerificationOffer
} from "./research.ts";
export type {
  CandidateStatus,
  CompleteVerificationInput,
  CouncilAction,
  DecisionVisibility,
  EventChatMessage,
  HumanEvidence,
  HumanEvidenceResult,
  PreferencePrompt,
  RestaurantDecision,
  RestaurantDecisionType,
  UpsertDecisionInput,
  VerificationMethod,
  VerificationStatus,
  VerificationTask
} from "./collaboration.ts";

export const PrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "HARD"]);
export const ConstraintVisibilitySchema = z.enum(["PUBLIC", "PRIVATE_DERIVED"]);

export const ConstraintTypeSchema = z.enum([
  "MAX_PRICE_LEVEL",
  "MIN_RATING",
  "CUISINE_PREFER",
  "CUISINE_AVOID",
  "DIETARY",
  "ALLERGY",
  "ACCESSIBILITY",
  "MAX_DISTANCE_KM",
  "ATMOSPHERE",
  "OUTDOOR_SEATING",
  "AVOID_RESTAURANT",
  "FAVORITE_RESTAURANT"
]);

export const CouncilConstraintSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  participantId: z.string(),
  type: ConstraintTypeSchema,
  value: z.unknown(),
  priority: PrioritySchema,
  visibility: ConstraintVisibilitySchema
});

export type CouncilConstraint = z.infer<typeof CouncilConstraintSchema>;

export const RestaurantPhotoSchema = z.object({
  provider: z.enum(["google", "mock"]),
  providerPhotoId: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  attribution: z.string().optional()
});

export const RestaurantReviewSchema = z.object({
  provider: z.enum(["google", "mock"]),
  providerReviewId: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  text: z.string().optional(),
  authorName: z.string().optional(),
  relativeTimeDescription: z.string().optional(),
  publishedAt: z.string().optional(),
  attribution: z.string().optional()
});

export const RestaurantCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceLevel: z.number().int().min(1).max(4).optional(),
  priceRange: z
    .object({
      startAmount: z.number().optional(),
      endAmount: z.number().optional(),
      currencyCode: z.string().optional()
    })
    .optional(),
  rating: z.number().min(0).max(5).optional(),
  cuisines: z.array(z.string()),
  latitude: z.number(),
  longitude: z.number(),
  distanceKm: z.number().optional(),
  outdoorSeating: z.boolean().optional(),
  accessibility: z.array(z.string()).optional(),
  dietaryOptions: z.array(z.string()).optional(),
  address: z.string().optional(),
  hours: z.string().optional(),
  hoursWeekdayText: z.array(z.string()).optional(),
  openingHours: CandidateOpeningHoursSchema.optional(),
  hoursAssessment: RestaurantHoursAssessmentSchema.optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  reviewCount: z.number().optional(),
  photos: z.array(RestaurantPhotoSchema).optional(),
  reviews: z.array(RestaurantReviewSchema).optional(),
  providerAttribution: z.string().optional(),
  dietaryAssessments: z.array(DietaryAssessmentSchema).optional()
});

export type RestaurantCandidate = z.infer<typeof RestaurantCandidateSchema>;

export const MatchLabelSchema = z.enum([
  "Strong match",
  "Good match",
  "Acceptable",
  "Weak match",
  "Constraint conflict"
]);

export const EvaluationReasonCodeSchema = z.enum([
  "MATCH",
  "WEAK_MATCH",
  "PUBLIC_CONSTRAINT_CONFLICT",
  "PRIVATE_CONSTRAINT_CONFLICT",
  "HARD_CONSTRAINT_CONFLICT"
]);

export const CandidateEvaluationSchema = z.object({
  candidateId: z.string(),
  participantId: z.string(),
  score: z.number().min(0).max(100),
  label: MatchLabelSchema,
  reasonCode: EvaluationReasonCodeSchema,
  rejected: z.boolean(),
  privateConflict: z.boolean()
});

export type CandidateEvaluation = z.infer<typeof CandidateEvaluationSchema>;

export const PublicRejectionReasonSchema = z.object({
  participantId: z.string(),
  constraintType: ConstraintTypeSchema,
  priority: PrioritySchema,
  required: z.unknown(),
  actual: z.unknown(),
  summary: z.string()
});

export type PublicRejectionReason = z.infer<typeof PublicRejectionReasonSchema>;

export const RecommendationSchema = z.object({
  candidate: RestaurantCandidateSchema,
  councilScore: z.number().min(0).max(100),
  evaluations: z.array(CandidateEvaluationSchema),
  explanations: z.array(z.string()),
  rejected: z.boolean(),
  rejectionSummary: z.string().optional(),
  rejectionReasons: z.array(PublicRejectionReasonSchema).optional()
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

export const CouncilStatusSchema = z.enum([
  "CREATED",
  "COLLECTING_PREFERENCES",
  "DERIVING_CONSTRAINTS",
  "SEARCHING",
  "EVALUATING",
  "NEGOTIATING",
  "COMPLETE",
  "FAILED"
]);

export const CouncilRunSpendSchema = z.object({
  currency: z.literal("USD"),
  estimatedUsd: z.number(),
  agents: z.object({
    calls: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    cachedInputTokens: z.number().int().min(0).optional(),
    estimatedUsd: z.number(),
    byModel: z
      .array(
        z.object({
          model: z.string().min(1),
          calls: z.number().int().min(0),
          inputTokens: z.number().int().min(0),
          outputTokens: z.number().int().min(0),
          cachedInputTokens: z.number().int().min(0).optional(),
          estimatedUsd: z.number()
        })
      )
      .optional()
  }),
  places: z.object({
    calls: z.number().int().min(0),
    search: z.number().int().min(0),
    details: z.number().int().min(0),
    hours: z.number().int().min(0),
    photos: z.number().int().min(0),
    cachedCalls: z.number().int().min(0).optional(),
    cachedSearch: z.number().int().min(0).optional(),
    cachedDetails: z.number().int().min(0).optional(),
    cachedHours: z.number().int().min(0).optional(),
    cachedPhotos: z.number().int().min(0).optional(),
    estimatedUsd: z.number()
  })
});

export type CouncilRunSpend = z.infer<typeof CouncilRunSpendSchema>;

export const CouncilProgressSchema = z.object({
  phase: CouncilStatusSchema,
  step: z.string(),
  stepIndex: z.number().int().min(0).optional(),
  stepCount: z.number().int().min(1).optional(),
  agent: z
    .object({
      kind: z.enum(["personal", "negotiator", "council"]),
      name: z.string(),
      userId: z.string().optional()
    })
    .optional(),
  tool: z
    .object({
      id: z.string(),
      name: z.string()
    })
    .optional(),
  detail: z.string().optional(),
  spend: CouncilRunSpendSchema.optional(),
  startedAt: z.string(),
  sessionStartedAt: z.string(),
  completedAt: z.string().optional()
});

export type CouncilProgress = z.infer<typeof CouncilProgressSchema>;

export {
  CouncilAgentLogSchema,
  parseLoggedPayload,
  sanitizeAgentLogEntry,
  sanitizeAgentLogValue
};
export type { CouncilAgentLog } from "./agent-logs.ts";

export const CouncilClientEventTypeSchema = z.enum([
  "council.started",
  "council.progress",
  "constraints.collected",
  "restaurant.search.started",
  "dietary.analysis.started",
  "restaurant.candidate.added",
  "candidate.evaluated",
  "candidate.rejected",
  "negotiation.round.started",
  "recommendation.updated",
  "verification.requested",
  "collaboration.updated",
  "council.completed",
  "council.failed"
]);

export const CouncilClientEventSchema = z.object({
  type: CouncilClientEventTypeSchema,
  at: z.string(),
  message: z.string(),
  payload: z.record(z.unknown()).optional()
});

export type CouncilClientEvent = z.infer<typeof CouncilClientEventSchema>;

export const CouncilSnapshotSchema = z.object({
  sessionId: z.string(),
  eventId: z.string(),
  status: CouncilStatusSchema,
  progress: CouncilProgressSchema.optional(),
  participants: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
      agentId: z.string()
    })
  ),
  negotiatorId: z.string(),
  constraints: z.array(CouncilConstraintSchema),
  candidates: z.array(RestaurantCandidateSchema),
  evaluations: z.array(CandidateEvaluationSchema),
  recommendations: z.array(RecommendationSchema),
  events: z.array(CouncilClientEventSchema),
  agentLogs: z.array(CouncilAgentLogSchema).optional(),
  error: z.string().optional()
});

export type CouncilSnapshot = z.infer<typeof CouncilSnapshotSchema>;

export function parseConstraints(input: unknown): CouncilConstraint[] {
  return z.array(CouncilConstraintSchema).parse(input);
}

export function dietaryConstraintsFromCouncil(constraints: CouncilConstraint[]): DietaryConstraint[] {
  return mergeDietaryConstraints(
    constraints.flatMap((constraint) => {
      if (constraint.type === "DIETARY") return parseDietaryConstraints(constraint.value);
      if (constraint.type === "ALLERGY") return allergyToDietaryConstraint(constraint.value);
      return [];
    })
  );
}

export function assertNoPrivateSource(constraint: CouncilConstraint): void {
  const serialized = JSON.stringify(constraint);
  if (
    serialized.includes("sourceText") ||
    serialized.includes("source_text") ||
    serialized.includes("privatePreference")
  ) {
    throw new Error("Constraint leaked private source fields");
  }
}

/**
 * Private derived constraints are for the Negotiator and the owning
 * Personal Agent. Client snapshots must not reveal that a participant
 * submitted a private constraint of a given type.
 */
export function sanitizeCouncilSnapshotForClients(
  snapshot: CouncilSnapshot
): CouncilSnapshot {
  const constraints = snapshot.constraints.filter(
    (constraint) => constraint.visibility === "PUBLIC"
  );
  return {
    ...snapshot,
    constraints,
    agentLogs: snapshot.agentLogs?.map(sanitizeAgentLogEntry),
    recommendations: snapshot.recommendations.map((recommendation) => ({
      ...recommendation,
      rejectionReasons: recommendation.rejectionReasons?.filter((reason) =>
        constraints.some(
          (constraint) =>
            constraint.participantId === reason.participantId &&
            constraint.type === reason.constraintType
        )
      )
    }))
  };
}
