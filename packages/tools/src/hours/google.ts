import { CURRENT_HOURS_HORIZON_DAYS, type RestaurantHours, type RestaurantOpeningPeriod } from "@rc/protocol";
import type { WeeklyOpeningPeriod } from "../domain.ts";
import { restaurantHoursFromWeekly } from "./materialize.ts";
import { zonedWallTimeToUtc } from "./timezone.ts";

export interface GoogleHoursPoint {
  day?: number;
  hour?: number;
  minute?: number;
  truncated?: boolean;
  date?: { year?: number; month?: number; day?: number };
}

export interface GoogleHoursPeriod {
  open?: GoogleHoursPoint;
  close?: GoogleHoursPoint;
}

export interface GoogleOpeningHours {
  openNow?: boolean;
  weekdayDescriptions?: string[];
  periods?: GoogleHoursPeriod[];
  nextCloseTime?: string;
}

export interface GoogleHoursPlace {
  currentOpeningHours?: GoogleOpeningHours;
  regularOpeningHours?: GoogleOpeningHours;
  timeZone?: { id?: string };
}

function weeklyFromGoogle(period: GoogleHoursPeriod): WeeklyOpeningPeriod | undefined {
  const open = period.open;
  if (!open || open.truncated || open.date) return undefined;
  if (open.day == null || open.hour == null || open.minute == null) return undefined;
  const weekly: WeeklyOpeningPeriod = {
    open: { day: open.day, hour: open.hour, minute: open.minute }
  };
  const close = period.close;
  if (!close || close.truncated) return weekly;
  if (close.day == null || close.hour == null || close.minute == null) return weekly;
  weekly.close = { day: close.day, hour: close.hour, minute: close.minute };
  return weekly;
}

function datedFromGoogle(
  period: GoogleHoursPeriod,
  timeZone: string
): RestaurantOpeningPeriod | undefined {
  const open = period.open;
  if (!open?.date || open.truncated) return undefined;
  const year = open.date.year;
  const month = open.date.month;
  const day = open.date.day;
  if (year == null || month == null || day == null || open.hour == null || open.minute == null) {
    return undefined;
  }
  const opensAt = zonedWallTimeToUtc(year, month, day, open.hour, open.minute, timeZone);
  if (!opensAt) return undefined;
  const close = period.close;
  if (!close || close.truncated) return { opensAt };
  const closeYear = close.date?.year ?? year;
  const closeMonth = close.date?.month ?? month;
  const closeDay = close.date?.day ?? day;
  if (close.hour == null || close.minute == null) return { opensAt };
  const closesAt = zonedWallTimeToUtc(closeYear, closeMonth, closeDay, close.hour, close.minute, timeZone);
  return closesAt ? { opensAt, closesAt } : { opensAt };
}

export function weeklyPeriodsFromGoogle(hours: GoogleOpeningHours | undefined): WeeklyOpeningPeriod[] {
  const weekly: WeeklyOpeningPeriod[] = [];
  for (const period of hours?.periods ?? []) {
    const mapped = weeklyFromGoogle(period);
    if (mapped) weekly.push(mapped);
  }
  return weekly;
}

export function datedPeriodsFromGoogle(
  hours: GoogleOpeningHours | undefined,
  timeZone: string
): RestaurantOpeningPeriod[] {
  const dated: RestaurantOpeningPeriod[] = [];
  for (const period of hours?.periods ?? []) {
    const mapped = datedFromGoogle(period, timeZone);
    if (mapped) dated.push(mapped);
  }
  return dated;
}

function daysUntil(eventDateTime: string, now = new Date()): number {
  const event = Date.parse(eventDateTime);
  if (!Number.isFinite(event)) return Number.POSITIVE_INFINITY;
  return (event - now.getTime()) / 86_400_000;
}

export function googlePlaceToRestaurantHours(
  place: GoogleHoursPlace,
  eventDateTime: string,
  retrievedAt: string,
  now = new Date()
): RestaurantHours | undefined {
  const timeZone = place.timeZone?.id?.trim();
  if (!timeZone) return undefined;
  const preferCurrent = daysUntil(eventDateTime, now) <= CURRENT_HOURS_HORIZON_DAYS;
  const currentWeekly = weeklyPeriodsFromGoogle(place.currentOpeningHours);
  const regularWeekly = weeklyPeriodsFromGoogle(place.regularOpeningHours);
  const currentDated = datedPeriodsFromGoogle(place.currentOpeningHours, timeZone);
  const useCurrent = preferCurrent && (currentDated.length > 0 || currentWeekly.length > 0);
  const sourceType = useCurrent ? "current" : "regular";
  const source = { provider: "google", retrievedAt, type: sourceType as "current" | "regular" };

  if (useCurrent && currentDated.length) {
    return { periods: currentDated, source };
  }
  const weekly = useCurrent ? currentWeekly : regularWeekly.length ? regularWeekly : currentWeekly;
  return restaurantHoursFromWeekly(weekly, eventDateTime, timeZone, source);
}
