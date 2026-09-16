# Restaurant Council — Real Restaurant Discovery Requirements

## 1. Overview

Restaurant Council currently uses a pre-populated restaurant list. Replace that approach with real-time restaurant discovery so an event can search for real restaurants in essentially any supported geographic area.

The system should use a provider abstraction, with Google Places API (New) as the initial implementation, while keeping the rest of Restaurant Council independent of any specific restaurant data provider.

This feature should preserve Restaurant Council's privacy architecture: personal agents may use private user preferences to help evaluate restaurants, but private preferences must not be unnecessarily exposed to other users, other personal agents, or external restaurant providers.

---

## 2. Goals

The implementation should:

- Search real restaurants by city, neighborhood, landmark, address, or coordinates.
- Allow an event to define a geographic search area.
- Support restaurant discovery using real provider data instead of a static catalog.
- Normalize third-party restaurant data into Restaurant Council's own domain model.
- Keep third-party API credentials server-side.
- Minimize external API cost and unnecessary data retrieval.
- Allow the Council to progressively search, filter, evaluate, and refine candidates.
- Preserve private participant preferences.
- Make the restaurant provider replaceable.
- Support future providers such as Yelp, OpenStreetMap-based services, reservation platforms, or custom data sources.
- Cache/reference restaurant data without turning Restaurant Council into a permanent restaurant catalog.

---

## 3. Non-Goals for Initial Version

The first implementation does not need to:

- Aggregate restaurant data from multiple providers.
- Deduplicate the same restaurant across providers.
- Book reservations.
- Retrieve live table availability.
- Analyze full restaurant review text.
- Maintain a comprehensive local restaurant database.
- Implement routing or exact drive-time calculations.
- Guarantee support for every restaurant worldwide.

These should remain possible future extensions.

---

## 4. Architecture

Introduce a Restaurant Search Service between Restaurant Council and external restaurant providers.

```text
Personal Agents
      |
      | sanitized/searchable constraints
      v
Negotiator
      |
      | RestaurantSearchRequest
      v
Restaurant Search Service
      |
      v
RestaurantProvider
      |
      +-----------------------+
      |                       |
      v                       v
Google Places          Future Providers
(initial)              Yelp / OSM / etc.
```

The frontend and Council agents must not call Google Places directly.

All external restaurant discovery should pass through the backend Restaurant Search Service.

---

## 5. Provider Abstraction

Create a provider-neutral interface.

```ts
export interface RestaurantProvider {
  search(
    request: RestaurantSearchRequest
  ): Promise<RestaurantSearchResult>;

  getDetails(
    providerRestaurantId: string
  ): Promise<Restaurant>;
}
```

The initial implementation should be:

```ts
export class GooglePlacesRestaurantProvider
  implements RestaurantProvider {
  // ...
}
```

Application code outside the provider layer should not depend directly on Google Places response types.

---

## 6. Restaurant Domain Model

Create a normalized internal representation.

```ts
export interface Restaurant {
  id: string;

  provider: RestaurantProviderType;
  providerId: string;

  name: string;
  address?: string;

  location: {
    latitude: number;
    longitude: number;
  };

  cuisines: string[];

  primaryType?: string;

  priceLevel?: number;

  rating?: number;
  reviewCount?: number;

  website?: string;
  phone?: string;

  attributes?: {
    vegetarian?: boolean;
    outdoorSeating?: boolean;
    reservable?: boolean;
    servesAlcohol?: boolean;
  };

  openingHours?: RestaurantOpeningHours;

  providerMetadata?: Record<string, unknown>;
}
```

Provider-specific fields should generally not leak into the rest of the application.

---

## 7. Restaurant Identity

Restaurant Council needs its own restaurant reference ID.

Do not use the Google Place ID as the application's primary database ID.

Example:

```text
Restaurant Council ID:
res_01K...

Provider:
google

Provider ID:
ChIJ...
```

This permits restaurants from multiple providers later.

A restaurant provider reference should be unique by:

```text
(provider, providerRestaurantId)
```

---

## 8. Event Search Location

An event should have a restaurant search area.

Suggested model:

```ts
export interface EventSearchArea {
  displayName: string;

  latitude: number;
  longitude: number;

  radiusMeters: number;

  source?: "address" | "city" | "neighborhood" | "landmark" | "coordinates";

  providerPlaceId?: string;
}
```

Example:

```json
{
  "displayName": "Brickell, Miami, FL",
  "latitude": 25.7617,
  "longitude": -80.1918,
  "radiusMeters": 8000,
  "source": "neighborhood"
}
```

The event creator should be able to enter locations such as:

- Brickell, Miami
- Manhattan
- Near Madison Square Garden
- 123 Main Street, Chicago
- Downtown Austin

The UI should resolve the entered location into coordinates before restaurant discovery begins.

---

## 9. Location Search UI

Replace any UI that assumes a predefined restaurant list.

When creating or editing an event, provide:

```text
Where should we eat?

[ Brickell, Miami                     ]

Search radius
[ 5 miles ▼ ]
```

The location field should eventually support autocomplete.

After selecting a location, store the normalized search area with the event.

The UI should display the resolved location so users can verify that the intended area was selected.

---

## 10. Restaurant Search Request

Create a provider-neutral request.

```ts
export interface RestaurantSearchRequest {
  location: {
    latitude: number;
    longitude: number;
  };

  radiusMeters: number;

  cuisines?: string[];

  priceLevels?: number[];

  dietaryRequirements?: string[];

  attributes?: string[];

  textQuery?: string;

  limit?: number;
}
```

Example:

```json
{
  "location": {
    "latitude": 25.7617,
    "longitude": -80.1918
  },
  "radiusMeters": 8000,
  "cuisines": ["steakhouse", "american"],
  "priceLevels": [1, 2],
  "dietaryRequirements": ["vegetarian-options"],
  "limit": 40
}
```

Not every provider will support every filter directly.

The provider implementation should translate supported filters and allow Restaurant Council to perform additional filtering after retrieval.

---

## 11. Google Places Integration

Use Google Places API (New) as the first restaurant provider.

Support two discovery modes.

### 11.1 Nearby Search

Use Nearby Search when Restaurant Council already has:

- latitude
- longitude
- search radius

Request restaurants within that geographic area.

### 11.2 Text Search

Use Text Search when semantic/location-oriented queries are more appropriate.

Examples:

```text
Italian restaurants near Times Square
Steakhouses near the convention center
Seafood restaurants in South Beach
```

The provider should decide which Google operation is appropriate based on the RestaurantSearchRequest.

---

## 12. Field Masks and API Cost

Do not retrieve every available Google Places field during discovery.

The discovery search should retrieve only fields necessary to identify and initially rank candidates.

Suggested initial fields:

```text
id
displayName
formattedAddress
location
primaryType
types
priceLevel
rating
userRatingCount
```

More expensive/richer fields should be retrieved only for finalists when possible.

Examples:

```text
website
phone
opening hours
photos
reservable
outdoor seating
vegetarian options
```

The implementation should make field selection explicit rather than relying on broad/default provider responses.

---

## 13. Progressive Restaurant Discovery

Restaurant Council should not immediately perform expensive analysis on every restaurant returned by the provider.

Use a progressive pipeline.

```text
External Search
      |
      v
40-100 basic candidates
      |
      v
Deterministic Filtering
      |
      v
10-20 plausible candidates
      |
      v
Council / Agent Evaluation
      |
      v
3-5 finalists
      |
      v
Fetch Rich Details
      |
      v
Final Council Recommendation
```

Exact candidate counts may be configurable.

The important requirement is that expensive API calls and AI evaluations occur only after cheaper filtering.

---

## 14. Deterministic Filtering

Before invoking AI agents, apply deterministic constraints where possible.

Examples:

- geographic radius
- required cuisine
- required dietary accommodation
- price level
- minimum rating
- currently open, if requested
- restaurant type

AI should not be used to determine something that can reliably be determined from structured provider data.

---

## 15. Agent Tooling

Restaurant discovery should be exposed to the agent/orchestration system as tools.

Initial tools:

```text
search_restaurants
get_restaurant_details
```

Potential future tools:

```text
search_restaurant_reviews
get_travel_time
check_reservation_availability
find_alternative_restaurants
```

Suggested tool contract:

```ts
interface SearchRestaurantsToolInput {
  location: {
    latitude: number;
    longitude: number;
  };

  radiusMeters: number;

  cuisines?: string[];
  priceLevels?: number[];
  dietaryRequirements?: string[];

  textQuery?: string;

  limit?: number;
}
```

The tool should call RestaurantSearchService rather than a provider directly.

---

## 16. Privacy Requirements

Restaurant Council's existing privacy model must apply to restaurant discovery.

A personal agent may know private information such as:

```text
"I really need dinner to stay below $30,
but I don't want the group to know that."
```

The system must not unnecessarily expose that statement.

Instead, the personal agent should convert private preferences into the minimum constraint information required for negotiation or restaurant evaluation.

For example:

```json
{
  "priceConstraint": {
    "maxPriceLevel": 2
  }
}
```

Other users should not receive:

```text
Sarah cannot afford expensive restaurants.
```

The external restaurant provider must never receive user identities or private preference explanations when those details are unnecessary for restaurant discovery.

---

## 17. Negotiator Responsibilities

The Negotiator should combine participant constraints into a RestaurantSearchRequest.

Example:

```text
User A:
likes steakhouses

User B:
private budget constraint

User C:
needs vegetarian options

User D:
doesn't want to travel far
```

The Negotiator might produce:

```json
{
  "location": {
    "latitude": 25.7617,
    "longitude": -80.1918
  },
  "radiusMeters": 8000,
  "cuisines": [
    "steakhouse",
    "american"
  ],
  "priceLevels": [1, 2],
  "dietaryRequirements": [
    "vegetarian-options"
  ]
}
```

The Negotiator should know only the information necessary to perform its role.

---

## 18. Hard vs. Soft Constraints

The negotiation system should distinguish between:

```ts
type ConstraintStrength =
  | "required"
  | "preferred";
```

Example:

```ts
interface RestaurantConstraint {
  type: string;
  value: unknown;
  strength: ConstraintStrength;
}
```

Examples:

```text
Peanut allergy       REQUIRED
Vegetarian options   REQUIRED
Under $30             PREFERRED
Italian food          PREFERRED
Outdoor seating       PREFERRED
Within 5 miles        REQUIRED
```

Required constraints should normally eliminate candidates.

Preferred constraints should contribute to candidate evaluation/ranking.

---

## 19. Search Broadening

A Council search may produce too few candidates.

The system should support progressive relaxation.

Example:

```text
Search #1
Steakhouse
$ / $$
5 miles
vegetarian options

0 restaurants
      ↓

Search #2
Steakhouse + American
$ / $$
7 miles
vegetarian options

3 restaurants
      ↓

Search #3
American / grill / steakhouse
$ / $$ / $$$
10 miles
vegetarian options
```

Required constraints must not be silently relaxed.

Only preferred constraints may be automatically broadened.

Any relaxation should be represented in the negotiation/search state so the system can explain why candidates were included.

---

## 20. Restaurant Search Service

Create a service similar to:

```ts
export class RestaurantSearchService {
  constructor(
    private readonly provider: RestaurantProvider,
    private readonly cache: RestaurantCache
  ) {}

  async search(
    request: RestaurantSearchRequest
  ): Promise<RestaurantSearchResult> {
    // ...
  }

  async getDetails(
    restaurantId: string
  ): Promise<Restaurant> {
    // ...
  }
}
```

Responsibilities:

- Validate requests.
- Apply configured search limits.
- Call the provider.
- Normalize provider results.
- Cache appropriate results.
- Apply deterministic filters.
- Deduplicate results.
- Return Restaurant Council domain objects.
- Record provider/search metadata needed for diagnostics.

---

## 21. API Endpoints

Suggested backend endpoints:

### Search Restaurants

```http
POST /api/restaurants/search
```

Request:

```json
{
  "latitude": 25.7617,
  "longitude": -80.1918,
  "radiusMeters": 8000,
  "cuisines": ["steakhouse"],
  "priceLevels": [1, 2],
  "limit": 40
}
```

Response:

```json
{
  "restaurants": [],
  "search": {
    "provider": "google",
    "resultCount": 24
  }
}
```

### Restaurant Details

```http
GET /api/restaurants/:restaurantId
```

### Resolve Search Location

Possible endpoint:

```http
POST /api/locations/resolve
```

or integrate provider autocomplete/location resolution through dedicated backend endpoints.

The client must not directly use private provider API credentials.

---

## 22. Cloudflare Deployment

The feature must remain compatible with Restaurant Council's Cloudflare deployment.

Expected stack:

```text
React
   |
   v
Cloudflare-hosted frontend
   |
   v
Cloudflare Worker
Node.js / TypeScript-compatible backend
   |
   v
RestaurantSearchService
   |
   v
Google Places API
```

Google API credentials must be stored as Cloudflare secrets/environment bindings.

Never expose provider credentials in:

- React bundles
- public environment variables
- repository files
- API responses
- logs

---

## 23. Persistence

Restaurant Council should not attempt to mirror the Google Places restaurant catalog.

Persist references and cached data only as needed.

Suggested table:

```text
restaurant_references
-----------------------------
id
provider
provider_restaurant_id
name
latitude
longitude
cached_data
cached_at
created_at
updated_at
```

Unique constraint:

```text
(provider, provider_restaurant_id)
```

Event candidates should reference Restaurant Council's restaurant ID.

Example:

```text
event_restaurant_candidates
-----------------------------
id
event_id
restaurant_id
search_id
status
created_at
```

---

## 24. Search Sessions

Persist enough information to understand how a candidate entered the Council.

Suggested model:

```text
restaurant_searches
-----------------------------
id
event_id
provider
location
radius
constraints
query
result_count
created_at
```

This is useful for:

- debugging
- explaining recommendations
- reproducing decisions
- evaluating agent behavior
- measuring provider/API usage

Private user explanations should not be copied into these records.

Store sanitized constraints.

---

## 25. Caching

Implement caching to reduce duplicate provider calls.

Possible cache keys:

```text
restaurant details:
provider + providerRestaurantId

restaurant search:
provider + location bucket + radius + normalized filters
```

Cache lifetimes should differ by data type.

Relatively stable:

- name
- coordinates
- address
- cuisine/type

Shorter-lived:

- opening hours
- operational status
- rating
- review count

Do not assume cached data is permanently accurate.

---

## 26. Provider Metadata

Retain limited provider metadata useful for debugging and future provider functionality.

However, provider-specific response objects should not become the Restaurant Council domain model.

Keep the boundary:

```text
Google response
      ↓
GooglePlacesRestaurantProvider
      ↓
Restaurant
      ↓
Restaurant Council
```

not:

```text
Google response
      ↓
entire application
```

---

## 27. Error Handling

The system must gracefully handle:

- provider timeout
- provider rate limit
- invalid location
- no restaurants found
- malformed provider response
- missing optional fields
- expired/stale cache
- invalid API credentials
- provider outage
- geographic areas with limited provider coverage

Provider errors should be converted into Restaurant Council application errors.

Do not expose provider credentials or raw sensitive error details to clients.

---

## 28. Observability

Record metrics such as:

```text
restaurant_search_count
restaurant_search_latency
restaurant_search_result_count
restaurant_details_requests
restaurant_cache_hits
restaurant_cache_misses
provider_errors
provider_rate_limits
```

Also record approximate provider usage so API costs can be monitored.

Avoid logging private user preference text.

---

## 29. Open-Source Configuration

Because Restaurant Council will be open source, provider configuration must be replaceable.

Example:

```env
RESTAURANT_PROVIDER=google
GOOGLE_PLACES_API_KEY=...
```

Document how contributors can supply their own provider credentials.

The application should fail with a useful configuration error when no restaurant provider is configured.

Do not commit real credentials.

Provide an `.env.example` or equivalent configuration example.

---

## 30. Development / Demo Provider

Retain a deterministic mock provider for:

- unit tests
- local development without API credentials
- CI
- demos where external APIs are unavailable

Example:

```ts
export class MockRestaurantProvider
  implements RestaurantProvider {
  // deterministic fixture data
}
```

This mock provider replaces the current hard-coded catalog as a development/testing mechanism, not as the production discovery system.

---

## 31. Testing Requirements

### Unit Tests

Test:

- provider response normalization
- RestaurantSearchRequest validation
- hard constraint filtering
- soft constraint handling
- provider error translation
- cache behavior
- search broadening rules
- restaurant identity mapping

### Provider Contract Tests

Every RestaurantProvider implementation should pass the same contract test suite.

Example:

```text
RestaurantProviderContractTests
    |
    +-- MockRestaurantProvider
    |
    +-- GooglePlacesRestaurantProvider
    |
    +-- Future YelpRestaurantProvider
```

### Integration Tests

Test:

```text
API
 ↓
RestaurantSearchService
 ↓
MockRestaurantProvider
```

Do not require live Google API calls in normal CI.

Live provider tests may exist separately and should require explicit credentials.

---

## 32. Security Requirements

- Provider API keys remain server-side.
- Validate all search parameters.
- Clamp maximum search radius.
- Clamp maximum result count.
- Rate-limit public restaurant search endpoints.
- Authenticate event-specific searches where appropriate.
- Verify event membership before exposing Council search state.
- Do not send private user preference text to restaurant providers.
- Do not expose another participant's private constraints through API responses.
- Sanitize provider content before rendering.
- Avoid storing unnecessary provider response data.

---

## 33. Future Multi-Provider Architecture

The design should eventually allow:

```text
RestaurantSearchService
        |
        +-----------------+
        |                 |
        v                 v
GooglePlacesProvider   YelpProvider
        |                 |
        +--------+--------+
                 |
                 v
          Candidate Merger
                 |
                 v
             Council
```

Future functionality may enrich one provider's restaurant with another provider's information.

Do not implement this aggregation yet, but avoid architectural decisions that make it difficult.

---

## 34. Future Reservation Integration

Restaurant discovery and restaurant reservations should remain separate capabilities.

Future tools may include:

```text
check_reservation_availability
find_available_restaurants
create_reservation
```

Conceptually:

```text
Restaurant Discovery Providers
Google / Yelp / etc.
          |
          v
Restaurant Council Restaurant
          |
          v
Reservation Provider
OpenTable / Resy / etc.
```

A restaurant may therefore eventually contain provider mappings for multiple external systems.

Do not assume a Google Place ID is sufficient for reservation functionality.

---

## 35. Suggested Implementation Phases

### Phase 1 — Domain Abstraction

Implement:

- Restaurant
- RestaurantProvider
- RestaurantSearchRequest
- RestaurantSearchResult
- MockRestaurantProvider
- provider contract tests

Refactor existing code to consume RestaurantProvider instead of the static restaurant list.

### Phase 2 — Google Places

Implement:

- GooglePlacesRestaurantProvider
- Nearby Search
- result normalization
- basic details lookup
- field masks
- server-side credentials
- error translation

### Phase 3 — Event Locations

Implement:

- EventSearchArea
- location input
- location resolution
- radius selection
- event persistence

### Phase 4 — Real Search Pipeline

Implement:

```text
Event
 ↓
Negotiator
 ↓
RestaurantSearchRequest
 ↓
RestaurantSearchService
 ↓
Google Places
 ↓
Candidates
 ↓
Council
```

### Phase 5 — Progressive Details

Add:

- cheap initial discovery
- deterministic filtering
- finalist selection
- richer detail retrieval
- caching

### Phase 6 — Agent Tools

Expose:

```text
search_restaurants
get_restaurant_details
```

Allow the orchestration layer to iteratively search and refine candidates.

### Phase 7 — Search Broadening

Implement automatic broadening of preferred constraints when searches produce insufficient candidates.

Never automatically relax required constraints.

---

## 36. Acceptance Criteria

The feature is complete for the initial release when:

1. Restaurant Council no longer requires a pre-populated restaurant list for production use.
2. A user can create an event and specify a real geographic search area.
3. Restaurant Council can retrieve real restaurants in that area.
4. Google Places is accessed only from the backend.
5. Provider credentials are not exposed to the frontend.
6. Restaurant data is normalized into provider-neutral domain objects.
7. Existing Council logic operates on normalized Restaurant objects.
8. Private preference explanations are not sent to Google Places.
9. Required constraints can eliminate unsuitable restaurants.
10. Preferred constraints can influence candidate evaluation.
11. The system can retrieve richer details for finalists.
12. Restaurant/provider references can be cached.
13. A mock provider supports automated tests and credential-free development.
14. Provider failures produce useful application errors.
15. The architecture allows another RestaurantProvider to be added without rewriting Council logic.

---

## 37. End-State Example

A user creates:

```text
Friday Dinner

Location:
Brickell, Miami

Radius:
5 miles
```

Four participants join.

Their personal agents privately learn:

```text
Person A:
likes steak

Person B:
wants an inexpensive meal

Person C:
requires vegetarian options

Person D:
prefers somewhere nearby
```

The agents communicate only necessary constraints.

The Negotiator constructs:

```text
Cuisine:
steakhouse / American

Price:
$ / $$

Required:
vegetarian options

Radius:
5 miles
```

Restaurant Council calls:

```text
search_restaurants
```

The Restaurant Search Service queries Google Places and returns real restaurants.

Structured filters remove unsuitable candidates.

The personal agents privately evaluate the remaining candidates against their users' preferences.

The Negotiator identifies finalists.

Restaurant Council calls:

```text
get_restaurant_details
```

for those finalists.

The Council then presents the group with real restaurant recommendations while keeping each participant's private motivations private.

This should replace the current static restaurant catalog as the primary Restaurant Council discovery workflow.
