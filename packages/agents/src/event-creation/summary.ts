import type { EventCreationIntent } from "@rc/protocol";
import { formatDisplayDate, formatDisplayTime } from "./dates.ts";

export function summarizeIntent(intent: EventCreationIntent, timezone: string): string {
  const lines = ["Here's what I understood:"];
  if (intent.date) {
    lines.push(formatDisplayDate(intent.date, timezone));
  }
  if (intent.time?.time) {
    lines.push(
      `${formatDisplayTime(intent.time.time)}${intent.time.approximate ? " (around then)" : ""}`
    );
  } else if (intent.time?.dayPart) {
    lines.push(intent.time.dayPart);
  }
  if (intent.location) {
    const miles = intent.location.radiusMiles ?? 5;
    const place = intent.location.resolvedLocation?.displayName ?? intent.location.query;
    lines.push(`Within ${formatMiles(miles)} miles of`);
    lines.push(place);
  }
  if (intent.partySize) lines.push(`Party of ${intent.partySize}`);
  const requirementLines = [
    ...(intent.requirements ?? []).map(
      (item) => `${item.strength === "required" ? "✓" : "○"} ${labelRequirement(item.type)}`
    ),
    ...(intent.dietaryRequirements ?? []).map(
      (item) => `${item.strength === "required" ? "✓" : "○"} ${item.requirement}`
    ),
    ...(intent.cuisines ?? []).map((item) => {
      const mark = item.strength === "required" ? "✓" : "○";
      return item.polarity === "exclude" ? `${mark} No ${item.value}` : `${mark} ${item.value}`;
    }),
    ...(intent.price
      ? [
          `${intent.price.strength === "required" ? "✓" : "○"} ${
            intent.price.maxPerPerson
              ? `Under $${intent.price.maxPerPerson} per person`
              : intent.price.description ?? "Price limit"
          }`
        ]
      : [])
  ];
  if (requirementLines.length) {
    lines.push("Requirements");
    lines.push(...requirementLines);
  }
  if (intent.restaurantSearchPolicy?.minimumOpenAfterEventMinutes) {
    const minutes = intent.restaurantSearchPolicy.minimumOpenAfterEventMinutes;
    const hours = minutes / 60;
    const duration =
      Number.isInteger(hours) ? `${hours} hour${hours === 1 ? "" : "s"}` : `${minutes} minutes`;
    lines.push(`Stay open at least ${duration} after we arrive`);
  }
  if (intent.invitees?.length) {
    lines.push("Invite");
    for (const invitee of intent.invitees) {
      lines.push([invitee.displayName, invitee.email].filter(Boolean).join(" · "));
    }
  }
  return lines.filter(Boolean).join("\n");
}

function formatMiles(miles: number): string {
  return Number.isInteger(miles) ? String(miles) : miles.toFixed(1);
}

function labelRequirement(type: string): string {
  if (type === "kid-friendly") return "Kid friendly";
  if (type === "outdoor-seating") return "Outdoor seating";
  return type.replaceAll("-", " ");
}
