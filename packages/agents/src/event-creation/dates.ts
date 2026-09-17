import type { EventParserContext } from "@rc/protocol";

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

export function localDateParts(context: EventParserContext): LocalDateParts {
  const instant = new Date(context.currentDateTime);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: context.timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(Number.isNaN(instant.getTime()) ? new Date() : instant);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayName = lookup("weekday").toLowerCase();
  const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].findIndex((item) =>
    weekdayName.startsWith(item)
  );
  return {
    year: Number(lookup("year")),
    month: Number(lookup("month")),
    day: Number(lookup("day")),
    weekday: weekday < 0 ? instant.getUTCDay() : weekday
  };
}

function ymd(parts: LocalDateParts, offsetDays = 0): string {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays);
  const date = new Date(utc);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function daysUntilWeekday(from: number, target: number, nextWeek: boolean): number {
  let delta = (target - from + 7) % 7;
  if (nextWeek) {
    delta = delta === 0 ? 7 : delta + 7;
  }
  return delta;
}

export function resolveRelativeDate(text: string, context: EventParserContext): string | undefined {
  const lower = text.toLowerCase().replaceAll("’", "'");
  const today = localDateParts(context);
  if (/\btoday\b/.test(lower)) return ymd(today);
  if (/\btomorrow\b/.test(lower)) return ymd(today, 1);
  if (/\bthis weekend\b/.test(lower)) {
    return ymd(today, daysUntilWeekday(today.weekday, 6, false));
  }
  for (const [index, name] of WEEKDAYS.entries()) {
    const next = new RegExp(`\\bnext ${name}\\b`);
    const current = new RegExp(`\\b(?:this )?${name}\\b`);
    if (next.test(lower)) return ymd(today, daysUntilWeekday(today.weekday, index, true));
    if (current.test(lower)) return ymd(today, daysUntilWeekday(today.weekday, index, false));
  }
  const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso?.[1] && isValidIsoDate(iso[1])) return iso[1];
  return undefined;
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function extractTimeIntent(text: string): {
  time?: string;
  approximate?: boolean;
  dayPart?: "breakfast" | "lunch" | "afternoon" | "dinner" | "evening";
} | undefined {
  const lower = text.toLowerCase().replaceAll(".", "");
  const clock = lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] ?? 0);
    const mer = clock[3];
    if (mer === "pm" && hour < 12) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return undefined;
    return {
      time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      approximate: /\baround\b/.test(lower)
    };
  }
  const military = lower.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (military) {
    return {
      time: `${String(Number(military[1])).padStart(2, "0")}:${military[2]}`,
      approximate: false
    };
  }
  if (/\bnoon\b/.test(lower)) return { time: "12:00", approximate: false, dayPart: "lunch" };
  const aroundHour = lower.match(/\b(?:around|at|and)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (aroundHour && !clock) {
    let hour = Number(aroundHour[1]);
    const minute = Number(aroundHour[2] ?? 0);
    const mer = aroundHour[3];
    if (mer === "pm" && hour < 12) hour += 12;
    else if (mer === "am" && hour === 12) hour = 0;
    else if (!mer && hour > 0 && hour <= 7) hour += 12;
    if (hour <= 23 && minute <= 59) {
      return {
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        approximate: /\baround\b/.test(lower)
      };
    }
  }
  if (/\bearly dinner\b|\bdinner\b/.test(lower)) return { dayPart: "dinner" };
  if (/\blunch\b/.test(lower)) return { dayPart: "lunch" };
  if (/\bbreakfast\b/.test(lower)) return { dayPart: "breakfast" };
  if (/\bafternoon\b/.test(lower)) return { dayPart: "afternoon" };
  if (/\bevening\b|\bnight\b/.test(lower)) return { dayPart: "evening" };
  return undefined;
}

export function combineDateAndTime(
  date: string,
  time: string | undefined,
  timeZone: string
): string {
  const clock = time ?? "19:00";
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = timezoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess - offset).toISOString();
}

function timezoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(utcMs));
  const num = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(num("year"), num("month") - 1, num("day"), num("hour") % 24, num("minute"), num("second"));
  return asUtc - utcMs;
}

export function formatDisplayDate(date: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(utc);
}

export function formatDisplayTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const mer = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${hour12}:00 ${mer}` : `${hour12}:${String(minute).padStart(2, "0")} ${mer}`;
}
