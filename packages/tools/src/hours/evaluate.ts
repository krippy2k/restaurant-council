import {
  DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES,
  type RestaurantHours,
  type RestaurantHoursAssessment,
  type RestaurantOpeningPeriod
} from "@rc/protocol";
import { addMinutes } from "@rc/shared";

export interface RestaurantHoursEvaluationOptions {
  restaurantId: string;
  minimumOpenAfterEventMinutes?: number;
}

function parseInstant(value: string): number | undefined {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function periodContains(period: RestaurantOpeningPeriod, eventMs: number): boolean {
  const open = parseInstant(period.opensAt);
  if (open == null || eventMs < open) return false;
  if (!period.closesAt) return true;
  const close = parseInstant(period.closesAt);
  if (close == null) return false;
  return eventMs < close;
}

function findOpeningPeriodContaining(
  periods: RestaurantOpeningPeriod[],
  eventMs: number
): RestaurantOpeningPeriod | undefined {
  return periods.find((period) => periodContains(period, eventMs));
}

export function evaluateRestaurantHours(
  hours: RestaurantHours | undefined,
  eventDateTime: string,
  options: RestaurantHoursEvaluationOptions
): RestaurantHoursAssessment {
  const minimum =
    options.minimumOpenAfterEventMinutes ?? DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES;
  const eventMs = parseInstant(eventDateTime);
  const requiredOpenUntil =
    eventMs == null ? eventDateTime : addMinutes(new Date(eventMs).toISOString(), minimum);
  const restaurantId = options.restaurantId;

  if (eventMs == null) {
    return {
      restaurantId,
      status: "unknown",
      eventDateTime,
      minimumOpenAfterEventMinutes: minimum,
      requiredOpenUntil,
      source: hours?.source
    };
  }

  if (!hours || hours.periods.length === 0) {
    return {
      restaurantId,
      status: "unknown",
      eventDateTime: new Date(eventMs).toISOString(),
      minimumOpenAfterEventMinutes: minimum,
      requiredOpenUntil,
      source: hours?.source
    };
  }

  const requiredMs = parseInstant(requiredOpenUntil) ?? eventMs + minimum * 60_000;
  const period = findOpeningPeriodContaining(hours.periods, eventMs);
  if (!period) {
    return {
      restaurantId,
      status: "closed",
      eventDateTime: new Date(eventMs).toISOString(),
      minimumOpenAfterEventMinutes: minimum,
      requiredOpenUntil,
      source: hours.source
    };
  }

  if (!period.closesAt) {
    return {
      restaurantId,
      status: "suitable",
      eventDateTime: new Date(eventMs).toISOString(),
      minimumOpenAfterEventMinutes: minimum,
      requiredOpenUntil,
      applicablePeriod: period,
      source: hours.source
    };
  }

  const closeMs = parseInstant(period.closesAt);
  const status =
    closeMs != null && closeMs >= requiredMs ? "suitable" : "closes-too-soon";
  return {
    restaurantId,
    status,
    eventDateTime: new Date(eventMs).toISOString(),
    minimumOpenAfterEventMinutes: minimum,
    requiredOpenUntil,
    applicablePeriod: period,
    source: hours.source
  };
}
