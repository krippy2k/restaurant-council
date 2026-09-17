import {
  DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES,
  type RestaurantHours,
  type RestaurantHoursAssessment
} from "@rc/protocol";
import { nowIso } from "@rc/shared";
import type { Restaurant } from "../domain.ts";
import { evaluateRestaurantHours } from "./evaluate.ts";
import {
  datedPeriodsFromGoogle,
  weeklyPeriodsFromGoogle,
  type GoogleHoursPlace
} from "./google.ts";
import { restaurantHoursFromWeekly } from "./materialize.ts";

export const HOURS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const HOURS_CURRENT_CACHE_TTL_MS = HOURS_CACHE_TTL_MS;
export const HOURS_REGULAR_CACHE_TTL_MS = HOURS_CACHE_TTL_MS;

export function hoursAreFresh(restaurant: Restaurant, now = Date.now()): boolean {
  const retrievedAt = restaurant.openingHours?.retrievedAt;
  if (!retrievedAt || !hasStructuredHours(restaurant)) return false;
  const retrieved = Date.parse(retrievedAt);
  if (!Number.isFinite(retrieved)) return false;
  return now - retrieved < HOURS_CACHE_TTL_MS;
}

export function hasStructuredHours(restaurant: Restaurant): boolean {
  const hours = restaurant.openingHours;
  return Boolean(
    hours?.weeklyPeriods?.length ||
      hours?.currentWeeklyPeriods?.length ||
      hours?.regularWeeklyPeriods?.length ||
      hours?.datedPeriods?.length
  );
}

export function hoursFromRestaurant(
  restaurant: Restaurant,
  eventDateTime: string
): RestaurantHours | undefined {
  const stored = restaurant.openingHours;
  const timeZone = stored?.timeZone;
  const retrievedAt = stored?.retrievedAt ?? nowIso();
  if (stored?.datedPeriods?.length) {
    return {
      periods: stored.datedPeriods,
      source: {
        provider: restaurant.provider,
        retrievedAt,
        type: stored.sourceType
      }
    };
  }
  if (!timeZone) return undefined;
  const preferCurrent = Boolean(stored?.currentWeeklyPeriods?.length && stored.sourceType !== "regular");
  const weekly =
    (preferCurrent ? stored?.currentWeeklyPeriods : stored?.regularWeeklyPeriods) ??
    stored?.weeklyPeriods ??
    stored?.currentWeeklyPeriods ??
    stored?.regularWeeklyPeriods;
  return restaurantHoursFromWeekly(weekly, eventDateTime, timeZone, {
    provider: restaurant.provider,
    retrievedAt,
    type: stored?.sourceType ?? (preferCurrent ? "current" : "regular")
  });
}

export function assessRestaurantHours(
  restaurant: Restaurant,
  eventDateTime: string | undefined,
  minimumOpenAfterEventMinutes = DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES
): RestaurantHoursAssessment {
  if (!eventDateTime) {
    return evaluateRestaurantHours(undefined, "", {
      restaurantId: restaurant.id,
      minimumOpenAfterEventMinutes
    });
  }
  return evaluateRestaurantHours(hoursFromRestaurant(restaurant, eventDateTime), eventDateTime, {
    restaurantId: restaurant.id,
    minimumOpenAfterEventMinutes
  });
}

export function openingHoursFromGooglePlace(
  place: GoogleHoursPlace,
  retrievedAt: string
): Restaurant["openingHours"] | undefined {
  const timeZone = place.timeZone?.id?.trim();
  const weekdayText =
    place.currentOpeningHours?.weekdayDescriptions ?? place.regularOpeningHours?.weekdayDescriptions;
  const openNow = place.currentOpeningHours?.openNow ?? place.regularOpeningHours?.openNow;
  const currentWeekly = weeklyPeriodsFromGoogle(place.currentOpeningHours);
  const regularWeekly = weeklyPeriodsFromGoogle(place.regularOpeningHours);
  const datedPeriods = timeZone ? datedPeriodsFromGoogle(place.currentOpeningHours, timeZone) : [];
  if (
    !weekdayText &&
    !currentWeekly.length &&
    !regularWeekly.length &&
    !datedPeriods.length &&
    openNow == null
  ) {
    return undefined;
  }
  return {
    weekdayText,
    openNow,
    timeZone,
    retrievedAt,
    sourceType: currentWeekly.length || datedPeriods.length ? "current" : "regular",
    currentWeeklyPeriods: currentWeekly.length ? currentWeekly : undefined,
    regularWeeklyPeriods: regularWeekly.length ? regularWeekly : undefined,
    weeklyPeriods: currentWeekly.length ? currentWeekly : regularWeekly.length ? regularWeekly : undefined,
    datedPeriods: datedPeriods.length ? datedPeriods : undefined
  };
}
