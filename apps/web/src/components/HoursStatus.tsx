import type { RestaurantView } from "../restaurant-display";

type HoursAssessment = NonNullable<RestaurantView["hoursAssessment"]>;

function formatClock(iso: string, timeZone: string): string {
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

function formatWeekday(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date);
  } catch {
    return "";
  }
}

export function hoursRejectionReason(assessment: HoursAssessment, timeZone = "UTC"): string | undefined {
  const start = formatClock(assessment.eventDateTime, timeZone);
  const required = formatClock(assessment.requiredOpenUntil, timeZone);
  if (assessment.status === "closed") {
    return `It is not open at ${start}, when your event starts.`;
  }
  if (assessment.status === "closes-too-soon") {
    const close = assessment.applicablePeriod?.closesAt
      ? formatClock(assessment.applicablePeriod.closesAt, timeZone)
      : required;
    return `It closes at ${close}. Your event starts at ${start}, and Restaurant Council requires at least ${assessment.minimumOpenAfterEventMinutes} minutes before closing.`;
  }
  if (assessment.status === "unknown") {
    return "Published hours could not be verified for the event time.";
  }
  return undefined;
}

export function HoursStatus({
  assessment,
  timeZone,
  compact = false
}: {
  assessment?: HoursAssessment;
  timeZone?: string;
  compact?: boolean;
}) {
  if (!assessment) return null;
  const zone = timeZone || "UTC";
  const weekday = formatWeekday(assessment.eventDateTime, zone);
  const start = formatClock(assessment.eventDateTime, zone);
  const required = formatClock(assessment.requiredOpenUntil, zone);
  const close = assessment.applicablePeriod?.closesAt
    ? formatClock(assessment.applicablePeriod.closesAt, zone)
    : undefined;
  const exact =
    assessment.applicablePeriod?.closesAt != null &&
    new Date(assessment.applicablePeriod.closesAt).getTime() ===
      new Date(assessment.requiredOpenUntil).getTime();

  let mark: "ok" | "bad" | "unknown" = "unknown";
  let headline = "Could not verify";
  let lines = ["This restaurant otherwise matches the event."];
  if (assessment.status === "suitable") {
    mark = "ok";
    headline = close ? `Open until ${close}` : "Open 24 hours";
    lines = exact
      ? ["Meets the minimum", `Closes 1 hour after the ${start} event start`]
      : ["Open for the event", "More than 1 hour before closing"];
  } else if (assessment.status === "closes-too-soon") {
    mark = "bad";
    headline = close ? `Open until ${close}` : "Closes too soon";
    lines = [
      "Closes too soon",
      `The event starts at ${start} and Restaurant Council requires the restaurant to remain open until at least ${required}.`
    ];
  } else if (assessment.status === "closed") {
    mark = "bad";
    headline = "Closed for the event";
    lines = [`Not open at ${start}`];
  }

  const glyph = mark === "ok" ? "✓" : mark === "bad" ? "✗" : "?";
  return (
    <div className={`hours-status ${mark} ${compact ? "compact" : ""}`}>
      {weekday ? (
        <p className="hours-weekday">{assessment.status === "unknown" ? `${weekday} hours` : weekday}</p>
      ) : null}
      <p className="hours-headline">
        {glyph} {headline}
      </p>
      {compact ? null : (
        <ul>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {assessment.source?.type === "regular" && assessment.status === "suitable" ? (
        <p className="muted">Expected hours based on the regular schedule.</p>
      ) : null}
    </div>
  );
}
