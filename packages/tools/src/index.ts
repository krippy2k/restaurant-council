export type {
  PreferenceVault,
  RestaurantDetails,
  RestaurantSearchQuery,
  RestaurantSearchTool
} from "./types.ts";
export type {
  LocationResolver,
  LocationSuggestion,
  ResolvedLocation,
  Restaurant,
  RestaurantCache,
  RestaurantOpeningHours,
  RestaurantOpeningPeriod,
  RestaurantPhoto,
  RestaurantPhotoOptions,
  RestaurantPriceRange,
  RestaurantProvider,
  RestaurantProviderType,
  RestaurantReview,
  RestaurantSearchRequest,
  RestaurantSearchResult,
  WeeklyOpeningPeriod,
  WeeklyOpeningPoint
} from "./domain.ts";
export {
  DEFAULT_RADIUS_METERS,
  EVALUATION_CANDIDATE_LIMIT,
  MAX_RADIUS_METERS,
  MIN_RADIUS_METERS,
  SEARCH_PHOTO_LIMIT,
  FINALIST_PHOTO_LIMIT,
  DETAIL_REVIEW_LIMIT,
  CARD_PHOTO_MAX_WIDTH,
  HERO_PHOTO_MAX_WIDTH,
  clampRadiusMeters,
  milesToMeters
} from "./domain.ts";
export { FixtureRestaurantSearch } from "./restaurant-search-tool.ts";
export { AuthorizedRestaurantSearch } from "./restaurant-search-tool.ts";
export { MockRestaurantProvider } from "./restaurant-fixture.ts";
export { RestaurantSearchService } from "./service.ts";
export type { RestaurantSearchMetrics, ResolvedRestaurantPhoto } from "./service.ts";
export { MemoryRestaurantCache } from "./cache.ts";
export { MockLocationResolver, GoogleLocationResolver } from "./geocode.ts";
export { resolveLocationQuery } from "./resolve-location.ts";
export type { ResolveLocationOutput } from "./resolve-location.ts";
export { buildSearchRequest, searchAreaFromEvent, validateSearchRequest } from "./search-request.ts";
export { restaurantToCandidate } from "./map-candidate.ts";
export { applyDeterministicFilters, broadenSearchRequest } from "./filters.ts";
export { restaurantCouncilId } from "./identity.ts";
export { haversineKm } from "./geo.ts";
export {
  formatRatingLabel,
  ratingAriaLabel,
  photoAlt,
  normalizeRating,
  normalizeReviewCount,
  selectPrimaryPhoto,
  mergePhotos,
  reputationBonus,
  reputationScore,
  clampPhotoDimension,
  placeholderSvg,
  inferPriceLevelFromRange,
  typicalPriceRangeFromLevel,
  formatRestaurantPrice,
  formatMoneyAmount
} from "./enrichment.ts";
export type { PriceRangeAmounts } from "./enrichment.ts";
export { GooglePlacesRestaurantProvider, DISCOVERY_FIELD_MASK, DETAILS_FIELD_MASK, HOURS_FIELD_MASK, photosFromGoogle, reviewsFromGoogle, assertSafePhotoUrl, priceRangeFromGoogle } from "./google-places.ts";
export { estimatePlacesRequest, placesOperationFromUrl } from "./places-billing.ts";
export type { PlacesBillableRequest, PlacesCacheKind, PlacesOperation, PlacesSkuTier } from "./places-billing.ts";
export { evaluateRestaurantHours } from "./hours/evaluate.ts";
export { googlePlaceToRestaurantHours, weeklyPeriodsFromGoogle, datedPeriodsFromGoogle } from "./hours/google.ts";
export { materializeWeeklyPeriods, restaurantHoursFromWeekly } from "./hours/materialize.ts";
export {
  assessRestaurantHours,
  hasStructuredHours,
  hoursAreFresh,
  hoursFromRestaurant,
  openingHoursFromGooglePlace,
  HOURS_CACHE_TTL_MS,
  HOURS_CURRENT_CACHE_TTL_MS,
  HOURS_REGULAR_CACHE_TTL_MS
} from "./hours/from-restaurant.ts";
export { parseFixtureHours } from "./hours/parse-fixture.ts";
export { DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES } from "@rc/protocol";
export { MockDietaryAnalyzer } from "./dietary/mock-analyzer.ts";
export { EvidenceDietaryAnalyzer } from "./dietary/analyzer.ts";
export { CachingDietaryAnalyzer } from "./dietary/cache.ts";
export { MemoryDietaryCache } from "./dietary/memory-cache.ts";
export { assessDietaryEvidence, assessmentSatisfies, uncertainAssessment, makeEvidence } from "./dietary/rules.ts";
export { extractDietarySignals } from "./dietary/extract.ts";
export { structuredEvidenceForRequirement } from "./dietary/structured.ts";
export { mockDietaryFixture } from "./dietary/mock-fixtures.ts";
export { candidateAsRestaurant } from "./dietary/from-candidate.ts";
export {
  fetchOfficialRestaurantText,
  fetchWebsiteText
} from "./dietary/website.ts";
export { fetchRestaurantPage, extractLinks, extractJsonLd, stripHtml } from "./research/fetch-page.ts";
export {
  extractMenuItemsFromText,
  extractMenuItemsFromJsonLd,
  queryMatchesItem,
  menuItemsFromPage
} from "./research/menu.ts";
export { discoverReservationLinks, reservationDoesNotImplyAvailability } from "./research/reservation-links.ts";
export {
  createResearchTools,
  createResearchToolRegistry,
  createSearchMenuTool,
  evidenceFromMenuItems
} from "./research/tools.ts";
export type { ResearchRestaurant, ResearchTool, ResearchToolDeps, ResearchCache, CachedEvidence } from "./research/tools.ts";
export { createMockResearchTools, createMockSearchMenuTool, MOCK_SPORTS_GRILL_MENU, mockMenuFor } from "./research/mock.ts";
export { dietaryCacheKey, emptyDietaryMetrics } from "./dietary/types.ts";
export type {
  DietaryAnalyzer,
  DietaryAnalysisRequest,
  DietaryAnalysisMetrics,
  DietaryAssessmentCache
} from "./dietary/types.ts";
