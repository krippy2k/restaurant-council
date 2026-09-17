import type { Principal } from "@rc/auth";
import type { Preference, PrivatePreferenceRecord } from "@rc/domain";
import type { RestaurantCandidate } from "@rc/protocol";
import type { RestaurantSearchRequest } from "./domain.ts";

export interface RestaurantSearchQuery {
  eventId: string;
  latitude: number;
  longitude: number;
  radiusKm?: number;
  cuisines?: string[];
  maxPriceLevel?: number;
  query?: string;
}

export interface RestaurantDetails extends RestaurantCandidate {
  menuHighlights?: string[];
}

export interface RestaurantSearchTool {
  search(
    query: RestaurantSearchQuery,
    principal: Principal
  ): Promise<RestaurantCandidate[]>;
  getRestaurant(id: string, principal: Principal): Promise<RestaurantDetails>;
  enrichHours?(id: string, principal: Principal): Promise<RestaurantCandidate & { hoursCacheHit?: boolean }>;
  discover?(
    request: RestaurantSearchRequest,
    principal: Principal
  ): Promise<RestaurantCandidate[]>;
}

export interface PreferenceVault {
  readPrivate(
    principal: Principal,
    userId: string,
    eventId: string
  ): Promise<PrivatePreferenceRecord[]>;
  upsertPrivate(
    principal: Principal,
    record: {
      preference: Preference;
      sourceText?: string;
      structuredValue: Record<string, unknown>;
    }
  ): Promise<PrivatePreferenceRecord>;
}
