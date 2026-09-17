import {
  LlmEventIntentDraftSchema,
  type EventCreationIntent,
  type EventParserContext
} from "@rc/protocol";
import type { AgentRuntime } from "../runtime.ts";
import { applyDraft, type EventIntentParser } from "./parser.ts";
import { MockEventIntentParser } from "./parser.ts";

const PARSE_SYSTEM = `You convert restaurant-event requests into structured JSON.
Use only the supplied currentDateTime and timezone for relative dates. Do not use your own idea of today's date.
Never invent latitude, longitude, or provider place IDs.
Never copy private explanations, finances, medical stories, or "don't tell" language into title or description.
Dietary needs are objects {requirement, strength, evidenceRequirement}.
Kid friendly / family friendly becomes requirements: [{type:"kid-friendly", strength:"required"}].
Times such as "around 1pm", "around 7", or "at 3" are arrival times, never a price. Only set price when the user mentions money, $, dollars, cheap/inexpensive, or a per-person budget.
Extract invitees from email addresses in the text as invitees: [{email, displayName?}]. Never invent emails that are not in the text.
If the user asks for the restaurant to stay open a duration after arrival, set restaurantSearchPolicy.minimumOpenAfterEventMinutes (two hours → 120). Default is 60 when omitted.
Return JSON matching the schema. relativeDate may be "Saturday" or "tomorrow" if the user used those words.`;

export class LlmEventIntentParser implements EventIntentParser {
  private readonly fallback = new MockEventIntentParser();

  constructor(private readonly runtime: AgentRuntime) {}

  async parse(text: string, context: EventParserContext): Promise<EventCreationIntent> {
    try {
      const draft = await this.runtime.completeStructured({
        system: PARSE_SYSTEM,
        user: JSON.stringify({ text, currentDateTime: context.currentDateTime, timezone: context.timezone }),
        schema: LlmEventIntentDraftSchema
      });
      return applyDraft(text, context, draft);
    } catch {
      return this.fallback.parse(text, context);
    }
  }
}
