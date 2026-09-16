import {
  stripHallucinatedLocation,
  type CreateEventCommand,
  type EventCreationIntent,
  type EventParserContext
} from "@rc/protocol";
import { mergeIntent, type EventIntentParser } from "./parser.ts";
import { collectMissingFields, intentToCommand, questionsFromIntent, validateEventIntent } from "./validate.ts";
import { summarizeIntent } from "./summary.ts";

export const DEFAULT_EVENT_RADIUS_MILES = 5;

export interface ResolvedPlace {
  displayName: string;
  latitude: number;
  longitude: number;
  provider?: string;
  providerPlaceId?: string;
  source?: "address" | "city" | "neighborhood" | "landmark" | "coordinates";
}

export interface LocationLookupResult {
  status: "resolved" | "ambiguous" | "not-found";
  location?: ResolvedPlace;
  candidates?: ResolvedPlace[];
}

export interface EventCreationResult {
  intent: EventCreationIntent;
  questions: string[];
  summary: string;
  readyToCreate: boolean;
  command?: CreateEventCommand;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
  fallbackToForm?: boolean;
}

export class EventCreationAgent {
  constructor(
    private readonly parser: EventIntentParser,
    private readonly lookup: (query: string) => Promise<LocationLookupResult>
  ) {}

  async interpret(text: string, context: EventParserContext): Promise<EventCreationResult> {
    try {
      const parsed = stripHallucinatedLocation(await this.parser.parse(text.slice(0, 2000), context));
      return this.finalize(parsed, context);
    } catch {
      return this.failed(context);
    }
  }

  async prepare(intent: EventCreationIntent, context: EventParserContext): Promise<EventCreationResult> {
    return this.finalize(stripHallucinatedLocation(intent), context);
  }

  async modify(
    current: EventCreationIntent,
    text: string,
    context: EventParserContext
  ): Promise<EventCreationResult> {
    try {
      const patch = stripHallucinatedLocation(await this.parser.parse(text.slice(0, 2000), context));
      const merged = mergeIntent(stripHallucinatedLocation(current), patch);
      return this.finalize(merged, context);
    } catch {
      return this.failed(context);
    }
  }

  private failed(context: EventParserContext): EventCreationResult {
    const intent: EventCreationIntent = {
      eventType: "restaurant",
      missingFields: [{ field: "location", required: true, reason: "Could not interpret that request." }],
      ambiguities: [],
      source: "natural-language"
    };
    return {
      intent,
      questions: [],
      summary: summarizeIntent(intent, context.timezone),
      readyToCreate: false,
      errors: [{ field: "parse", message: "Could not interpret that request." }],
      warnings: [],
      fallbackToForm: true
    };
  }

  private async finalize(
    intent: EventCreationIntent,
    context: EventParserContext
  ): Promise<EventCreationResult> {
    let next: EventCreationIntent = {
      ...intent,
      missingFields: collectMissingFields(intent),
      ambiguities: []
    };
    if (next.location?.query && next.location.radiusMiles == null) {
      next = {
        ...next,
        location: { ...next.location, radiusMiles: DEFAULT_EVENT_RADIUS_MILES }
      };
    }
    if (next.location?.query) {
      const lookup = await this.lookup(next.location.query);
      if (lookup.status === "resolved" && lookup.location) {
        next = {
          ...next,
          location: {
            ...next.location,
            resolvedLocation: lookup.location
          }
        };
      } else if (lookup.status === "ambiguous") {
        next = {
          ...next,
          ambiguities: [
            {
              field: "location",
              description: "Several places match that name. Which one did you mean?",
              candidates: lookup.candidates
            }
          ]
        };
      } else {
        next = {
          ...next,
          missingFields: [
            ...next.missingFields.filter((field) => field.field !== "location" || !next.location?.query),
            { field: "location", required: true, reason: "I couldn't find that place. Try an address, landmark, or neighborhood." }
          ]
        };
      }
    }

    const validation = validateEventIntent(next);
    const command = validation.valid ? intentToCommand(next, context.timezone) : undefined;
    const questions = questionsFromIntent(next);
    return {
      intent: next,
      questions,
      summary: summarizeIntent(next, context.timezone),
      readyToCreate: Boolean(command) && questions.length === 0 && validation.valid,
      command,
      errors: validation.errors,
      warnings: validation.warnings
    };
  }
}

export function formValuesFromIntent(intent: EventCreationIntent): {
  name: string;
  date: string;
  query: string;
  radiusMiles: number;
} {
  const date = intent.date ? `${intent.date}T${intent.time?.time ?? "19:00"}` : "";
  return {
    name: intent.title || "Dinner",
    date,
    query: intent.location?.resolvedLocation?.displayName ?? intent.location?.query ?? "",
    radiusMiles: intent.location?.radiusMiles ?? DEFAULT_EVENT_RADIUS_MILES
  };
}
