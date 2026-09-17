export type RestaurantProviderType = "google" | "mock";

export interface RestaurantLocation {
  latitude: number;
  longitude: number;
}

export interface WeeklyOpeningPoint {
  day: number;
  hour: number;
  minute: number;
}

export interface WeeklyOpeningPeriod {
  open: WeeklyOpeningPoint;
  close?: WeeklyOpeningPoint;
}

export interface RestaurantOpeningPeriod {
  opensAt: string;
  closesAt?: string;
}

export interface RestaurantOpeningHours {
  weekdayText?: string[];
  openNow?: boolean;
  timeZone?: string;
  retrievedAt?: string;
  sourceType?: "current" | "regular" | "human";
  weeklyPeriods?: WeeklyOpeningPeriod[];
  currentWeeklyPeriods?: WeeklyOpeningPeriod[];
  regularWeeklyPeriods?: WeeklyOpeningPeriod[];
  datedPeriods?: RestaurantOpeningPeriod[];
}

export interface RestaurantPhoto {
  provider: RestaurantProviderType;
  providerPhotoId: string;
  width?: number;
  height?: number;
  attribution?: string;
}

export interface RestaurantReview {
  provider: RestaurantProviderType;
  providerReviewId?: string;
  rating?: number;
  text?: string;
  authorName?: string;
  relativeTimeDescription?: string;
  publishedAt?: string;
  attribution?: string;
}

export interface RestaurantPhotoOptions {
  maxWidth?: number;
  maxHeight?: number;
}

export interface RestaurantPriceRange {
  startAmount?: number;
  endAmount?: number;
  currencyCode?: string;
}

export interface Restaurant {
  id: string;
  provider: RestaurantProviderType;
  providerId: string;
  name: string;
  address?: string;
  location: RestaurantLocation;
  cuisines: string[];
  primaryType?: string;
  priceLevel?: number;
  priceRange?: RestaurantPriceRange;
  rating?: number;
  reviewCount?: number;
  photos?: RestaurantPhoto[];
  reviews?: RestaurantReview[];
  providerAttribution?: string;
  website?: string;
  phone?: string;
  email?: string;
  attributes?: {
    vegetarian?: boolean;
    outdoorSeating?: boolean;
    reservable?: boolean;
    servesAlcohol?: boolean;
  };
  openingHours?: RestaurantOpeningHours;
  detailsCoverage?: "hours" | "details";
  detailsRetrievedAt?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface RestaurantSearchRequest {
  location: RestaurantLocation;
  radiusMeters: number;
  cuisines?: string[];
  priceLevels?: number[];
  dietaryRequirements?: string[];
  attributes?: string[];
  textQuery?: string;
  limit?: number;
  required?: {
    dietaryRequirements?: string[];
    maxPriceLevel?: number;
    maxRadiusMeters?: number;
    cuisines?: string[];
  };
  relaxation?: string[];
}

export interface RestaurantSearchResult {
  restaurants: Restaurant[];
  search: {
    provider: RestaurantProviderType;
    resultCount: number;
    cacheHit?: boolean;
    relaxation?: string[];
  };
}

export interface RestaurantProvider {
  readonly name: RestaurantProviderType;
  search(request: RestaurantSearchRequest): Promise<RestaurantSearchResult>;
  getDetails(providerRestaurantId: string, options?: { hoursOnly?: boolean }): Promise<Restaurant>;
  getPhotoUrl?(
    photo: RestaurantPhoto,
    options?: RestaurantPhotoOptions
  ): Promise<string>;
}

export interface RestaurantCache {
  getSearch(key: string): Promise<RestaurantSearchResult | null>;
  setSearch(key: string, result: RestaurantSearchResult, ttlMs: number): Promise<void>;
  getRestaurant(id: string): Promise<Restaurant | null>;
  getByProvider(
    provider: RestaurantProviderType,
    providerId: string
  ): Promise<Restaurant | null>;
  putRestaurant(restaurant: Restaurant): Promise<void>;
}

export interface LocationSuggestion {
  displayName: string;
  placeId?: string;
  source?: "address" | "city" | "neighborhood" | "landmark" | "coordinates";
}

export interface ResolvedLocation {
  displayName: string;
  latitude: number;
  longitude: number;
  source?: "address" | "city" | "neighborhood" | "landmark" | "coordinates";
  providerPlaceId?: string;
}

export interface LocationResolver {
  suggest(query: string): Promise<LocationSuggestion[]>;
  resolve(query: string, placeId?: string): Promise<ResolvedLocation>;
}

export const MIN_RADIUS_METERS = 500;
export const MAX_RADIUS_METERS = 50_000;
export const DEFAULT_RADIUS_METERS = 8_047;
export const MAX_SEARCH_LIMIT = 40;
export const DISCOVERY_LIMIT = 20;
export const EVALUATION_CANDIDATE_LIMIT = 16;
export const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
export const DETAILS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const RATING_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const PHOTO_CACHE_SECONDS = 86_400;
export const SEARCH_PHOTO_LIMIT = 1;
export const FINALIST_PHOTO_LIMIT = 5;
export const DETAIL_REVIEW_LIMIT = 3;
export const CARD_PHOTO_MAX_WIDTH = 800;
export const HERO_PHOTO_MAX_WIDTH = 1600;
export const PROVIDER_PHOTO_MAX_PX = 4800;

export function clampRadiusMeters(value: number | undefined): number {
  const radius = value ?? DEFAULT_RADIUS_METERS;
  return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.round(radius)));
}

export function milesToMeters(miles: number): number {
  return Math.round(miles * 1609.34);
}

export function metersToKm(meters: number): number {
  return meters / 1000;
}
