import { z } from "zod";
import { DietaryConstraintSchema } from "./dietary.ts";

export const EVENT_INTENT_PARSER_VERSION = "event-intent-parser:v1";

export const ConstraintStrengthSchema = z.enum(["required", "preferred"]);
export const EventDayPartSchema = z.enum([
  "breakfast",
  "lunch",
  "afternoon",
  "dinner",
  "evening"
]);

export const EventTimeIntentSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  approximate: z.boolean().optional(),
  dayPart: EventDayPartSchema.optional()
});

export const EventLocationIntentSchema = z.object({
  query: z.string().min(1).max(200),
  radiusMiles: z.number().min(0.3).max(31).optional(),
  resolvedLocation: z
    .object({
      displayName: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      provider: z.string().optional(),
      providerPlaceId: z.string().optional(),
      source: z.enum(["address", "city", "neighborhood", "landmark", "coordinates"]).optional()
    })
    .optional()
});

export const EventPreferenceSchema = z.object({
  value: z.string().min(1).max(40),
  strength: ConstraintStrengthSchema,
  polarity: z.enum(["include", "exclude"]).optional()
});

export const PriceConstraintSchema = z.object({
  maxPerPerson: z.number().min(1).max(500).optional(),
  providerPriceLevels: z.array(z.number().int().min(1).max(4)).optional(),
  description: z.string().max(80).optional(),
  strength: ConstraintStrengthSchema
});

export const EventRequirementSchema = z.object({
  type: z.string().min(1).max(40),
  value: z.unknown().optional(),
  strength: ConstraintStrengthSchema
});

export const InviteeIntentSchema = z.object({
  displayName: z.string().max(80).optional(),
  email: z.string().max(120).optional(),
  phone: z.string().max(32).optional()
});

export const MissingFieldSchema = z.object({
  field: z.string(),
  required: z.boolean(),
  reason: z.string().max(160).optional()
});

export const EventAmbiguitySchema = z.object({
  field: z.string(),
  description: z.string().max(200),
  candidates: z.array(z.unknown()).optional()
});

export const EventCreationIntentSchema = z.object({
  eventType: z.literal("restaurant").default("restaurant"),
  title: z.string().max(80).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: EventTimeIntentSchema.optional(),
  partySize: z.number().int().min(1).max(40).optional(),
  location: EventLocationIntentSchema.optional(),
  cuisines: z.array(EventPreferenceSchema).optional(),
  dietaryRequirements: z.array(DietaryConstraintSchema).optional(),
  price: PriceConstraintSchema.optional(),
  requirements: z.array(EventRequirementSchema).optional(),
  invitees: z.array(InviteeIntentSchema).optional(),
  missingFields: z.array(MissingFieldSchema).default([]),
  ambiguities: z.array(EventAmbiguitySchema).default([]),
  source: z.enum(["natural-language", "form"]).default("natural-language")
});

export type ConstraintStrength = z.infer<typeof ConstraintStrengthSchema>;
export type EventTimeIntent = z.infer<typeof EventTimeIntentSchema>;
export type EventLocationIntent = z.infer<typeof EventLocationIntentSchema>;
export type EventCreationIntent = z.infer<typeof EventCreationIntentSchema>;
export type PriceConstraint = z.infer<typeof PriceConstraintSchema>;
export type EventRequirement = z.infer<typeof EventRequirementSchema>;
export type InviteeIntent = z.infer<typeof InviteeIntentSchema>;
export type MissingField = z.infer<typeof MissingFieldSchema>;
export type EventAmbiguity = z.infer<typeof EventAmbiguitySchema>;

export const EventParserContextSchema = z.object({
  currentDateTime: z.string(),
  timezone: z.string().min(1).max(80)
});

export type EventParserContext = z.infer<typeof EventParserContextSchema>;

export const LlmEventIntentDraftSchema = EventCreationIntentSchema.omit({
  missingFields: true,
  ambiguities: true
}).extend({
  location: z
    .object({
      query: z.string().min(1).max(200),
      radiusMiles: z.number().optional()
    })
    .optional(),
  relativeDate: z.string().max(40).optional()
});

export type LlmEventIntentDraft = z.infer<typeof LlmEventIntentDraftSchema>;

export const CreateEventCommandSchema = z.object({
  name: z.string().min(1).max(80),
  date: z.string().optional(),
  locationLabel: z.string().min(1).max(200),
  radiusMiles: z.number().min(0.3).max(31),
  searchArea: z.object({
    displayName: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    radiusMeters: z.number(),
    source: z.enum(["address", "city", "neighborhood", "landmark", "coordinates"]).optional(),
    providerPlaceId: z.string().optional()
  })
});

export type CreateEventCommand = z.infer<typeof CreateEventCommandSchema>;

export function stripHallucinatedLocation(intent: EventCreationIntent): EventCreationIntent {
  if (!intent.location) return intent;
  return {
    ...intent,
    location: {
      query: intent.location.query,
      radiusMiles: intent.location.radiusMiles
    }
  };
}
