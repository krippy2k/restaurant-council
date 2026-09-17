import type { RestaurantHours, RestaurantOpeningPeriod } from "@rc/protocol";
import type { WeeklyOpeningPeriod, WeeklyOpeningPoint } from "../domain.ts";
import { addLocalDays, localWeekday, zonedParts, zonedWallTimeToUtc } from "./timezone.ts";

function validPoint(point: WeeklyOpeningPoint | undefined): point is WeeklyOpeningPoint {
  return (
    point != null &&
    Number.isInteger(point.day) &&
    point.day >= 0 &&
    point.day <= 6 &&
    Number.isInteger(point.hour) &&
    point.hour >= 0 &&
    point.hour <= 23 &&
    Number.isInteger(point.minute) &&
    point.minute >= 0 &&
    point.minute <= 59
  );
}

function isAlwaysOpen(periods: WeeklyOpeningPeriod[]): boolean {
  if (periods.length === 1 && validPoint(periods[0]?.open) && !periods[0]?.close) return true;
  return (
    periods.length === 7 &&
    periods.every((period) => validPoint(period.open) && !period.close && period.open.hour === 0 && period.open.minute === 0)
  );
}

export function materializeWeeklyPeriods(
  weekly: WeeklyOpeningPeriod[],
  eventDateTime: string,
  timeZone: string
): RestaurantOpeningPeriod[] | undefined {
  const local = zonedParts(eventDateTime, timeZone);
  if (!local) return undefined;
  const valid = weekly.filter((period) => validPoint(period.open));
  if (!valid.length) return undefined;
  if (isAlwaysOpen(valid)) {
    const opensAt = zonedWallTimeToUtc(local.year, local.month, local.day, 0, 0, timeZone);
    return opensAt ? [{ opensAt }] : undefined;
  }

  const periods: RestaurantOpeningPeriod[] = [];
  for (const offset of [-2, -1, 0, 1, 2, 3, 4, 5, 6]) {
    const date = addLocalDays(local.year, local.month, local.day, offset);
    const weekday = localWeekday(date.year, date.month, date.day, timeZone);
    if (weekday == null) continue;
    for (const period of valid) {
      if (period.open.day !== weekday) continue;
      const opensAt = zonedWallTimeToUtc(
        date.year,
        date.month,
        date.day,
        period.open.hour,
        period.open.minute,
        timeZone
      );
      if (!opensAt) continue;
      if (!period.close) {
        periods.push({ opensAt });
        continue;
      }
      if (!validPoint(period.close)) continue;
      let closeDate = { ...date };
      let guard = 0;
      while (
        localWeekday(closeDate.year, closeDate.month, closeDate.day, timeZone) !== period.close.day &&
        guard < 8
      ) {
        closeDate = addLocalDays(closeDate.year, closeDate.month, closeDate.day, 1);
        guard += 1;
      }
      let closesAt = zonedWallTimeToUtc(
        closeDate.year,
        closeDate.month,
        closeDate.day,
        period.close.hour,
        period.close.minute,
        timeZone
      );
      if (!closesAt) continue;
      if (Date.parse(closesAt) <= Date.parse(opensAt)) {
        const next = addLocalDays(closeDate.year, closeDate.month, closeDate.day, 7);
        closesAt =
          zonedWallTimeToUtc(next.year, next.month, next.day, period.close.hour, period.close.minute, timeZone) ??
          closesAt;
      }
      periods.push({ opensAt, closesAt });
    }
  }
  return periods.length ? periods : undefined;
}

export function restaurantHoursFromWeekly(
  weekly: WeeklyOpeningPeriod[] | undefined,
  eventDateTime: string,
  timeZone: string,
  source: RestaurantHours["source"]
): RestaurantHours | undefined {
  if (!weekly?.length) return undefined;
  const periods = materializeWeeklyPeriods(weekly, eventDateTime, timeZone);
  if (!periods) return undefined;
  return { periods, source };
}
