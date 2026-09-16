import { textRequestsSecrecy } from "@rc/domain";
import type { PreferencePrompt } from "@rc/protocol";
import { createId, nowIso } from "@rc/shared";

const CUISINES = [
  "italian",
  "mexican",
  "thai",
  "chinese",
  "japanese",
  "indian",
  "french",
  "steak",
  "seafood",
  "pizza",
  "sushi",
  "american"
];

export function detectPreferenceFromChat(input: {
  eventId: string;
  userId: string;
  sourceMessageId: string;
  text: string;
}): Omit<PreferencePrompt, "id" | "createdAt" | "status"> | undefined {
  const lower = input.text.toLowerCase().replaceAll("’", "'");
  const secret = textRequestsSecrecy(input.text);
  for (const cuisine of CUISINES) {
    if (new RegExp(`\\b${cuisine}\\b`).test(lower) && /prefer|rather|like/.test(lower)) {
      return {
        eventId: input.eventId,
        userId: input.userId,
        sourceMessageId: input.sourceMessageId,
        question: `Use ${cuisine} as a preferred cuisine for this event?`,
        category: "cuisine",
        visibility: secret ? "PRIVATE" : "PUBLIC",
        priority: "MEDIUM",
        value: { cuisines: [cuisine] }
      };
    }
  }
  const over =
    lower.match(/(?:can't|cannot|can not).{0,32}over\s*\$?\s*(\d+)/) ??
    lower.match(/under\s*\$?\s*(\d+)/) ??
    lower.match(/keep it (?:under|below)\s*\$?\s*(\d+)/);
  if (over) {
    const amount = Number(over[1]);
    const level = amount <= 15 ? 1 : amount <= 30 ? 2 : amount <= 60 ? 3 : 4;
    return {
      eventId: input.eventId,
      userId: input.userId,
      sourceMessageId: input.sourceMessageId,
      question: `Make $${amount}/person a required price limit for your preferences in this event?`,
      category: "price",
      visibility: secret ? "PRIVATE" : "PUBLIC",
      priority: "HARD",
      value: { maxPriceLevel: level, maxPerPerson: amount }
    };
  }
  if (/don't care about outdoor|do not care about outdoor|no longer need outdoor/.test(lower)) {
    return {
      eventId: input.eventId,
      userId: input.userId,
      sourceMessageId: input.sourceMessageId,
      question: "Remove outdoor seating from your preferences for this event?",
      category: "seating",
      visibility: "PUBLIC",
      priority: "LOW",
      value: { outdoor: false, remove: true }
    };
  }
  return undefined;
}

export function newPreferencePrompt(
  draft: Omit<PreferencePrompt, "id" | "createdAt" | "status">
): PreferencePrompt {
  return {
    ...draft,
    id: createId("ppr"),
    status: "pending",
    createdAt: nowIso()
  };
}
