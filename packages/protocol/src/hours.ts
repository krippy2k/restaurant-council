import { z } from "zod";

export const DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES = 60;
export const CURRENT_HOURS_HORIZON_DAYS = 7;

export const HoursAssessmentStatusSchema = z.enum([
  "suitable",
  "closes-too-soon",
  "closed",
  "unknown"
]);

export const HoursSourceTypeSchema = z.enum(["current", "regular", "human"]);

export const EventRestaurantSearchPolicySchema = z.object({
  minimumOpenAfterEventMinutes: z.number().int().min(15).max(360)
});

export type EventRestaurantSearchPolicy = z.infer<typeof EventRestaurantSearchPolicySchema>;

export const RestaurantOpeningPeriodSchema = z.object({
  opensAt: z.string(),
  closesAt: z.string().optional()
});

export type RestaurantOpeningPeriod = z.infer<typeof RestaurantOpeningPeriodSchema>;

export const RestaurantHoursSourceSchema = z.object({
  provider: z.string(),
  retrievedAt: z.string(),
  type: HoursSourceTypeSchema.optional()
});

export const RestaurantHoursSchema = z.object({
  periods: z.array(RestaurantOpeningPeriodSchema),
  source: RestaurantHoursSourceSchema
});

export type RestaurantHours = z.infer<typeof RestaurantHoursSchema>;

export const WeeklyOpeningPeriodSchema = z.object({
  open: z.object({
    day: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59)
  }),
  close: z
    .object({
      day: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59)
    })
    .optional()
});

export const CandidateOpeningHoursSchema = z.object({
  timeZone: z.string().optional(),
  weekdayText: z.array(z.string()).optional(),
  retrievedAt: z.string().optional(),
  sourceType: HoursSourceTypeSchema.optional(),
  weeklyPeriods: z.array(WeeklyOpeningPeriodSchema).optional(),
  currentWeeklyPeriods: z.array(WeeklyOpeningPeriodSchema).optional(),
  regularWeeklyPeriods: z.array(WeeklyOpeningPeriodSchema).optional(),
  datedPeriods: z.array(RestaurantOpeningPeriodSchema).optional()
});

export const RestaurantHoursAssessmentSchema = z.object({
  restaurantId: z.string(),
  status: HoursAssessmentStatusSchema,
  eventDateTime: z.string(),
  minimumOpenAfterEventMinutes: z.number().int(),
  requiredOpenUntil: z.string(),
  applicablePeriod: RestaurantOpeningPeriodSchema.optional(),
  source: RestaurantHoursSourceSchema.optional(),
  weekdayText: z.array(z.string()).optional()
});

export type RestaurantHoursAssessment = z.infer<typeof RestaurantHoursAssessmentSchema>;
export type HoursAssessmentStatus = z.infer<typeof HoursAssessmentStatusSchema>;

export function defaultRestaurantSearchPolicy(): EventRestaurantSearchPolicy {
  return { minimumOpenAfterEventMinutes: DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES };
}

export function formatHoursClock(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatHoursWeekday(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long"
    }).format(date);
  } catch {
    return "";
  }
}

export function hoursRejectionExplanation(
  assessment: RestaurantHoursAssessment,
  timeZone = "UTC"
): string | undefined {
  const start = formatHoursClock(assessment.eventDateTime, timeZone);
  const required = formatHoursClock(assessment.requiredOpenUntil, timeZone);
  if (assessment.status === "closed") {
    return `It is not open at ${start}, when your event starts.`;
  }
  if (assessment.status === "closes-too-soon") {
    const close = assessment.applicablePeriod?.closesAt
      ? formatHoursClock(assessment.applicablePeriod.closesAt, timeZone)
      : required;
    return `It closes at ${close}. Your event starts at ${start}, and Restaurant Council requires at least ${assessment.minimumOpenAfterEventMinutes} minutes before closing.`;
  }
  if (assessment.status === "unknown") {
    return "Published hours could not be verified for the event time.";
  }
  return undefined;
}

export function hoursStatusCopy(
  assessment: RestaurantHoursAssessment,
  timeZone = "UTC"
): {
  weekday?: string;
  headline: string;
  lines: string[];
  mark: "ok" | "warn" | "bad" | "unknown";
} {
  const weekday = formatHoursWeekday(assessment.eventDateTime, timeZone);
  const start = formatHoursClock(assessment.eventDateTime, timeZone);
  const required = formatHoursClock(assessment.requiredOpenUntil, timeZone);
  const close = assessment.applicablePeriod?.closesAt
    ? formatHoursClock(assessment.applicablePeriod.closesAt, timeZone)
    : undefined;
  const basedOnRegular = assessment.source?.type === "regular";
  const regularNote = basedOnRegular ? "Based on regular hours" : undefined;

  if (assessment.status === "suitable") {
    const exact =
      assessment.applicablePeriod?.closesAt != null &&
      new Date(assessment.applicablePeriod.closesAt).getTime() ===
        new Date(assessment.requiredOpenUntil).getTime();
    return {
      weekday,
      headline: close ? `Open until ${close}` : "Open 24 hours",
      lines: exact
        ? [`Meets the minimum`, `Closes 1 hour after the ${start} event start`]
        : ["Open for the event", `More than ${Math.round(assessment.minimumOpenAfterEventMinutes / 60) || 1} hour before closing`],
      mark: "ok"
    };
  }
  if (assessment.status === "closes-too-soon") {
    return {
      weekday,
      headline: close ? `Open until ${close}` : "Closes too soon",
      lines: [
        "Closes too soon",
        `The event starts at ${start} and Restaurant Council requires the restaurant to remain open until at least ${required}.`
      ],
      mark: "bad"
    };
  }
  if (assessment.status === "closed") {
    return {
      weekday,
      headline: "Closed for the event",
      lines: [`Not open at ${start}`],
      mark: "bad"
    };
  }
  return {
    weekday: weekday ? `${weekday} hours` : "Hours",
    headline: "Could not verify",
    lines: regularNote ? [regularNote] : ["This restaurant otherwise matches the event."],
    mark: "unknown"
  };
}
