export function timezoneOffsetMs(utcMs: number, timeZone: string): number | undefined {
  try {
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
    const hour = num("hour") % 24;
    const asUtc = Date.UTC(num("year"), num("month") - 1, num("day"), hour, num("minute"), num("second"));
    return asUtc - utcMs;
  } catch {
    return undefined;
  }
}

export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): string | undefined {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = timezoneOffsetMs(utcGuess, timeZone);
  if (offset == null) return undefined;
  return new Date(utcGuess - offset).toISOString();
}

export function zonedParts(
  iso: string,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(date);
    const num = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
    return {
      year: num("year"),
      month: num("month"),
      day: num("day"),
      hour: num("hour") % 24,
      minute: num("minute"),
      weekday: weekday >= 0 ? weekday : 0
    };
  } catch {
    return undefined;
  }
}

export function addLocalDays(
  year: number,
  month: number,
  day: number,
  days: number
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

export function localWeekday(year: number, month: number, day: number, timeZone: string): number | undefined {
  const noon = zonedWallTimeToUtc(year, month, day, 12, 0, timeZone);
  if (!noon) return undefined;
  return zonedParts(noon, timeZone)?.weekday;
}
