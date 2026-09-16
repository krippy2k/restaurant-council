import type { EventCreationIntent } from "@rc/protocol";
import type { PreferencePriority, PreferenceVisibility } from "@rc/domain";
import { textRequestsSecrecy } from "@rc/domain";

export interface CreatorPreferenceDraft {
  category: string;
  visibility: PreferenceVisibility;
  priority: PreferencePriority;
  value: Record<string, unknown>;
}

export function preferencesFromIntent(
  intent: EventCreationIntent,
  sourceText?: string
): CreatorPreferenceDraft[] {
  const secret = sourceText ? textRequestsSecrecy(sourceText) : false;
  const drafts: CreatorPreferenceDraft[] = [];
  const visibility = (preferred: boolean): PreferenceVisibility =>
    secret || preferred ? "PRIVATE" : "PUBLIC";
  const priority = (required: boolean): PreferencePriority => (required ? "HARD" : "MEDIUM");

  for (const cuisine of intent.cuisines ?? []) {
    drafts.push({
      category: cuisine.polarity === "exclude" ? "cuisine" : "cuisine",
      visibility: visibility(cuisine.strength === "preferred"),
      priority: priority(cuisine.strength === "required"),
      value:
        cuisine.polarity === "exclude"
          ? { avoid: [cuisine.value] }
          : { cuisines: [cuisine.value] }
    });
  }
  if (intent.dietaryRequirements?.length) {
    drafts.push({
      category: "dietary",
      visibility: visibility(intent.dietaryRequirements.every((item) => item.strength === "preferred")),
      priority: priority(intent.dietaryRequirements.some((item) => item.strength === "required")),
      value: {
        restrictions: intent.dietaryRequirements.map((item) => item.requirement),
        constraints: intent.dietaryRequirements
      }
    });
  }
  if (intent.price) {
    const maxLevel =
      intent.price.providerPriceLevels?.length
        ? Math.max(...intent.price.providerPriceLevels)
        : intent.price.maxPerPerson
          ? intent.price.maxPerPerson <= 15
            ? 1
            : intent.price.maxPerPerson <= 30
              ? 2
              : intent.price.maxPerPerson <= 60
                ? 3
                : 4
          : undefined;
    if (maxLevel) {
      drafts.push({
        category: "price",
        visibility: visibility(intent.price.strength === "preferred" || secret),
        priority: priority(intent.price.strength === "required" && !secret),
        value: { maxPriceLevel: maxLevel }
      });
    }
  }
  const atmosphere = (intent.requirements ?? [])
    .filter((item) => item.type === "kid-friendly" || item.type === "quiet")
    .map((item) => item.type);
  if (atmosphere.length) {
    drafts.push({
      category: "atmosphere",
      visibility: "PUBLIC",
      priority: priority(intent.requirements?.some((item) => item.type === "kid-friendly" && item.strength === "required") ?? false),
      value: { tags: atmosphere }
    });
  }
  if ((intent.requirements ?? []).some((item) => item.type === "outdoor-seating")) {
    drafts.push({
      category: "seating",
      visibility: "PUBLIC",
      priority: "MEDIUM",
      value: { outdoor: true }
    });
  }
  return drafts;
}
