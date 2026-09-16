# Restaurant Council — Restaurant Photos, Ratings & Reviews Requirements

## 1. Overview

Restaurant Council already supports real restaurant discovery through Google Places.

This feature extends the existing restaurant discovery implementation to enrich restaurant candidates and recommendations with visual and reputation data from Google Places, including:

- Restaurant photos
- Aggregate Google rating
- Google rating count
- Selected Google reviews, where available
- Required photo/review attribution
- UI presentation of this information

The goal is to make Restaurant Council recommendations feel like a real consumer restaurant-discovery experience while preserving the existing provider abstraction, privacy architecture, and cost-conscious progressive discovery pipeline.

---

## 2. Goals

Implement support for:

- Displaying restaurant photos in candidate and finalist UI.
- Displaying aggregate restaurant ratings.
- Displaying rating/review counts.
- Retrieving selected review information for restaurant details when useful.
- Fetching richer data primarily for finalists rather than every search result.
- Preserving Google attribution requirements.
- Keeping Google-specific implementation details inside the provider layer.
- Gracefully handling restaurants with missing photos, ratings, or reviews.
- Avoiding unnecessary Google Places requests and API cost.

---

## 3. Non-Goals

The initial implementation does not need to:

- Download and permanently store Google restaurant photos.
- Build a full photo gallery comparable to Google Maps.
- Retrieve every review for a restaurant.
- Perform sentiment analysis over large numbers of reviews.
- Scrape Google Maps or any other website.
- Allow users to upload restaurant photos.
- Aggregate ratings from Yelp or other providers.
- Treat ratings as the sole basis for Council recommendations.

These may be considered separately in future versions.

---

## 4. Domain Model Changes

Extend the existing provider-neutral `Restaurant` model.

```ts
export interface Restaurant {
  // existing fields...

  rating?: number;
  reviewCount?: number;

  photos?: RestaurantPhoto[];

  reviews?: RestaurantReview[];
}
```

Add provider-neutral photo and review models.

```ts
export interface RestaurantPhoto {
  provider: RestaurantProviderType;

  providerPhotoId: string;

  width?: number;
  height?: number;

  attribution?: string;
}
```

```ts
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
```

Do not expose raw Google Places response objects throughout the application.

---

## 5. Photo Architecture

Restaurant photos should remain provider-backed resources.

The preferred flow is:

```text
Google Places
     |
     | photo metadata/reference
     v
GooglePlacesRestaurantProvider
     |
     v
RestaurantPhoto
     |
     v
Restaurant Council API
     |
     v
React UI
```

Do not treat the Google photo itself as permanent Restaurant Council-owned content.

---

## 6. Photo Retrieval

The Google Places provider should retrieve photo metadata when appropriate.

The provider should expose a mechanism such as:

```ts
interface RestaurantProvider {
  // existing methods...

  getPhotoUrl?(
    photo: RestaurantPhoto,
    options?: RestaurantPhotoOptions
  ): Promise<string>;
}
```

or an equivalent abstraction that prevents Google-specific photo mechanics from leaking into the rest of the application.

Example options:

```ts
export interface RestaurantPhotoOptions {
  maxWidth?: number;
  maxHeight?: number;
}
```

The exact implementation should follow the current Google Places API photo requirements.

---

## 7. Photo URL Security

Google Places credentials must remain server-side.

If retrieving a photo requires authenticated provider access, the React client must not receive a secret Google API key.

Prefer a Restaurant Council endpoint such as:

```http
GET /api/restaurants/:restaurantId/photos/:photoId
```

or another server-mediated approach compatible with the existing Cloudflare deployment.

The implementation must not expose server-side provider credentials in:

- React bundles
- HTML
- API responses
- browser-visible environment variables
- logs
- generated photo URLs if doing so would expose a private credential

---

## 8. Photo Selection

Restaurant search results may contain multiple photos.

Restaurant Council should identify a primary photo.

Suggested selection strategy:

1. Use the provider's first/recommended photo when available.
2. Prefer landscape-friendly photos for restaurant cards where possible.
3. Preserve additional photos for finalist/detail views.
4. Do not attempt AI-based photo classification in the initial implementation.

Suggested limits:

```text
Search candidate:
0-1 displayed photos

Finalist:
up to 3-5 available photos

Restaurant details:
small gallery if sufficient photos exist
```

These limits should be configurable.

---

## 9. Photo UI

Restaurant cards should support a prominent photo.

Example:

```text
+--------------------------------------+
|                                      |
|         [ Restaurant Photo ]         |
|                                      |
+--------------------------------------+
| Fleming's Prime Steakhouse           |
| ★ 4.6 (2,143)   $$$                  |
| Steakhouse • 2.3 miles               |
|                                      |
| Recommended by the Council           |
+--------------------------------------+
```

The photo should:

- Maintain an appropriate aspect ratio.
- Crop gracefully when necessary.
- Avoid layout shifts while loading.
- Use lazy loading where appropriate.
- Include accessible alt text.
- Display a fallback when no photo exists.

Example fallback:

```text
+--------------------------------------+
|                                      |
|        No photo available            |
|                                      |
+--------------------------------------+
```

A neutral restaurant placeholder graphic may also be used.

---

## 10. Ratings

Display the aggregate provider rating when available.

Example:

```text
★ 4.6
```

Also display rating count:

```text
★ 4.6 (2,143)
```

The UI must distinguish:

```text
4.8 (12)
```

from:

```text
4.6 (2,143)
```

because rating count provides important context.

Do not fabricate a rating when the provider does not return one.

---

## 11. Rating Presentation

Restaurant cards should display ratings consistently.

Suggested format:

```text
★ 4.6 (2,143)
```

When rating exists but count does not:

```text
★ 4.6
```

When neither exists:

```text
No rating available
```

Avoid displaying:

```text
★ 0.0
```

for missing data.

---

## 12. Ratings and Council Evaluation

Google ratings may be used as one signal during restaurant evaluation.

They should not automatically determine the winner.

Example candidate evaluation signals might include:

```text
Hard constraints
    ↓
Participant preferences
    ↓
Cuisine fit
    ↓
Price fit
    ↓
Distance
    ↓
Dietary compatibility
    ↓
Restaurant rating/reputation
```

Rating should normally be treated as a soft signal.

A lower-rated restaurant may still be a better Council recommendation if it satisfies the group's constraints significantly better.

---

## 13. Rating Confidence

When using ratings algorithmically, consider rating count.

A restaurant with:

```text
4.9 stars
8 ratings
```

should not necessarily receive a stronger reputation signal than:

```text
4.7 stars
2,500 ratings
```

Do not implement a complex statistical model unless needed.

However, expose both:

```ts
rating
reviewCount
```

to the Council evaluation layer so future scoring can account for confidence/popularity.

---

## 14. Reviews

Restaurant details may include a limited set of provider-supplied reviews when available.

Reviews should primarily be retrieved for finalists or when a participant explicitly requests more information.

Do not retrieve reviews for every restaurant during initial discovery unless the API already supplies them at no meaningful additional cost.

---

## 15. Review UI

Reviews should appear primarily in the restaurant detail/finalist view.

Example:

```text
What diners are saying

★★★★★
"Excellent steaks and great service..."
— Alex R.

★★★★☆
"Good food, but very busy on Friday..."
— Jamie T.
```

Display only the information supplied and permitted by the provider.

Do not invent missing author names, timestamps, ratings, or review text.

---

## 16. Review Attribution

Preserve any attribution information required by Google Places.

Provider attribution must not be stripped during normalization.

The provider-neutral models should therefore support:

```ts
attribution?: string;
```

where needed.

The UI layer must render required attribution according to current provider requirements.

---

## 17. Progressive Data Retrieval

Continue using Restaurant Council's progressive discovery architecture.

Recommended flow:

```text
Restaurant Search
       |
       v
40-100 candidates
       |
       | basic fields
       v
Deterministic Filtering
       |
       v
10-20 candidates
       |
       | rating metadata
       v
Council Evaluation
       |
       v
3-5 finalists
       |
       | photos + richer details + reviews
       v
Final Recommendations
```

Avoid expensive detail/photo/review retrieval for restaurants that are eliminated early.

---

## 18. Initial Search Fields

During initial restaurant discovery, retrieve rating information when cost-effective.

Suggested fields include:

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
photos
```

The exact field mask should be reviewed against current Google Places pricing and API behavior.

Only request fields Restaurant Council actually uses.

---

## 19. Finalist Detail Fields

For finalists, retrieve richer information as appropriate:

```text
photos
reviews
website
phone
opening hours
reservable
outdoor seating
vegetarian options
```

This should happen only after candidate reduction whenever practical.

---

## 20. Caching

Cache restaurant metadata where permitted and appropriate.

Potential cached metadata:

```text
rating
reviewCount
photo references/metadata
review metadata
last refreshed timestamp
```

Do not assume ratings and review counts are permanent.

They should have an expiration/refresh strategy.

Example conceptual TTLs:

```text
Restaurant identity:
long-lived

Rating:
short/medium-lived

Review count:
short/medium-lived

Photo metadata:
medium/long-lived subject to provider rules

Operational information:
short-lived
```

Exact cache duration must comply with current provider terms.

---

## 21. Photo Caching

Do not permanently download and store Google photos by default.

Prefer storing only the provider photo reference/identifier and necessary metadata when allowed.

When the UI needs the photo:

```text
React
  |
  v
Restaurant Council API
  |
  v
RestaurantProvider
  |
  v
Google Places Photo API
```

If temporary edge caching through Cloudflare is implemented, verify that its behavior and duration comply with Google's current terms.

---

## 22. API Changes

Existing restaurant APIs should expose enriched metadata.

Example:

```http
GET /api/restaurants/:restaurantId
```

Response:

```json
{
  "id": "res_123",
  "name": "Example Steakhouse",
  "rating": 4.6,
  "reviewCount": 2143,
  "photos": [
    {
      "provider": "google",
      "providerPhotoId": "photo_abc",
      "width": 1600,
      "height": 900
    }
  ],
  "reviews": []
}
```

Do not return provider API credentials or raw authenticated Google URLs that expose secrets.

---

## 23. Photo Endpoint

If server-mediated photo access is required, implement an endpoint similar to:

```http
GET /api/restaurants/:restaurantId/photos/:photoId
```

Responsibilities:

- Validate restaurant identity.
- Validate photo identity.
- Resolve provider.
- Request or redirect to the appropriate provider resource safely.
- Apply appropriate caching.
- Handle missing/expired photo references.
- Never expose server credentials.

---

## 24. Frontend Components

Create reusable components such as:

```text
RestaurantCard
RestaurantPhoto
RestaurantRating
RestaurantReviewList
RestaurantDetails
RestaurantGallery
```

Example:

```tsx
<RestaurantCard restaurant={restaurant}>
  <RestaurantPhoto />
  <RestaurantRating />
</RestaurantCard>
```

Provider-specific rendering logic should be minimized.

---

## 25. Restaurant Card

Update the existing restaurant candidate card to include:

```text
Primary photo
Restaurant name
Rating
Rating count
Price level
Cuisine/type
Distance, if already supported
Key Council match information
```

The card should remain usable if any optional provider field is absent.

---

## 26. Final Recommendation UI

Final recommendations should be visually richer than initial candidates.

Example:

```text
# Council Pick

[Large restaurant photo]

Fleming's Prime Steakhouse

★ 4.6 (2,143)    $$$
Steakhouse

Why it works:
✓ Fits everyone's dietary requirements
✓ Within the agreed search area
✓ Strong match for preferred cuisine
✓ Price is within the negotiated range

[View details]
```

Do not reveal which participant contributed a private constraint unless that participant explicitly allowed disclosure.

For example, display:

```text
Price is within the negotiated range
```

not:

```text
Sarah needed somewhere inexpensive
```

---

## 27. Loading States

Photos may load separately from restaurant metadata.

Provide appropriate loading behavior.

Avoid:

- blank card areas
- dramatic layout shifts
- broken image icons

Use:

- fixed/aspect-ratio photo containers
- skeleton/loading placeholders
- graceful error fallback

---

## 28. Error Handling

Handle:

- no photos
- expired/invalid photo reference
- provider photo error
- photo timeout
- missing rating
- missing rating count
- no reviews
- malformed review data
- provider rate limits

A failed photo request must not cause the restaurant card itself to fail.

A failed review request must not prevent the Council from recommending the restaurant.

---

## 29. Accessibility

Restaurant photos require meaningful alt text.

Example:

```text
Photo of Fleming's Prime Steakhouse
```

Do not attempt to describe visual contents unless that description is actually known.

Ratings should be accessible to screen readers.

For example:

```html
<span aria-label="Rated 4.6 out of 5 from 2,143 ratings">
  ★ 4.6 (2,143)
</span>
```

Photo galleries must be keyboard accessible.

---

## 30. Performance

Requirements:

- Lazy-load offscreen restaurant photos.
- Do not fetch full-size images for small cards.
- Request appropriately sized provider photos.
- Avoid fetching galleries during initial search.
- Avoid retrieving reviews for every candidate.
- Cache safe metadata appropriately.
- Limit concurrent provider photo/detail requests.

The UI should remain responsive when displaying dozens of restaurant candidates.

---

## 31. Privacy

Photos, ratings, and reviews are restaurant/provider information and do not change Restaurant Council's participant privacy model.

However:

- Do not include private participant preference text in provider requests.
- Do not embed private constraints into photo or review URLs.
- Do not expose private constraints in analytics.
- Do not expose participant identities to Google when unnecessary.
- Do not reveal which participant caused a restaurant to be selected/eliminated.

---

## 32. Observability

Add metrics such as:

```text
restaurant_photo_requests
restaurant_photo_failures
restaurant_photo_cache_hits
restaurant_details_enrichment_requests
restaurant_review_requests
restaurant_rating_available
restaurant_rating_missing
```

Track provider API usage sufficiently to identify unexpected cost increases.

Do not log provider secrets or private participant preference text.

---

## 33. Provider Abstraction

The implementation must remain compatible with future providers.

For example:

```text
Restaurant
   |
   +-- rating
   +-- reviewCount
   +-- photos[]
   +-- reviews[]
```

should work whether the source is eventually:

```text
Google
Yelp
Tripadvisor
another restaurant provider
```

Do not name generic fields:

```text
googleRating
googlePhotos
googleReviews
```

Use provider-neutral names.

Provider identity can be retained on individual objects when necessary.

---

## 34. Testing

### Unit Tests

Test:

- Google rating normalization.
- Google rating-count normalization.
- Photo metadata normalization.
- Review normalization.
- Missing photo handling.
- Missing rating handling.
- Missing review handling.
- Attribution preservation.
- Photo dimension/options validation.
- Provider error translation.

### UI Tests

Test restaurant cards with:

```text
photo + rating + reviews
photo + rating
rating only
photo only
no enrichment data
very long restaurant name
large rating count
photo loading failure
```

### Integration Tests

Use the existing mock RestaurantProvider.

Add deterministic fixtures containing:

- multiple photos
- ratings
- rating counts
- reviews
- missing optional data

Normal CI must not require live Google Places requests.

---

## 35. Mock Provider Updates

Extend `MockRestaurantProvider` fixtures.

Example:

```ts
{
  id: "res_mock_1",
  provider: "mock",
  providerId: "mock_1",
  name: "Council Steakhouse",

  rating: 4.7,
  reviewCount: 1832,

  photos: [
    {
      provider: "mock",
      providerPhotoId: "photo_1",
      width: 1200,
      height: 800
    }
  ],

  reviews: [
    {
      provider: "mock",
      providerReviewId: "review_1",
      rating: 5,
      text: "Great dinner and excellent service.",
      authorName: "Test User"
    }
  ]
}
```

Use local fixture imagery or placeholders for mock photo tests rather than calling Google.

---

## 36. Implementation Phases

### Phase 1 — Domain Models

Implement:

- `RestaurantPhoto`
- `RestaurantReview`
- rating/review-count normalization
- extensions to `Restaurant`

### Phase 2 — Google Provider

Implement:

- photo metadata retrieval
- rating normalization
- rating count normalization
- review normalization
- attribution handling

### Phase 3 — Photo Delivery

Implement:

- secure photo resolution
- appropriately sized images
- caching where allowed
- missing-photo fallback

### Phase 4 — Restaurant Cards

Add:

- primary photo
- rating
- rating count
- responsive image handling
- loading/error states

### Phase 5 — Finalist Enrichment

Retrieve:

- additional photos
- selected reviews
- richer restaurant details

only for finalists when practical.

### Phase 6 — Final Recommendation UI

Add:

- larger hero photo
- rating/review count
- optional gallery
- selected reviews
- Council rationale

---

## 37. Acceptance Criteria

This feature is complete when:

1. Real restaurant cards can display Google Places photos.
2. Restaurant cards display Google aggregate ratings when available.
3. Restaurant cards display rating counts when available.
4. Missing ratings/photos do not break the UI.
5. Finalist/detail views can display selected Google reviews when available.
6. Required Google attribution is preserved and displayed.
7. Google API credentials remain server-side.
8. Restaurant Council does not permanently store Google photo binaries by default.
9. Photo requests use appropriately sized images.
10. Offscreen photos are lazy-loaded.
11. Rich review/detail retrieval is deferred until needed where practical.
12. Provider data is normalized into provider-neutral domain objects.
13. The existing mock provider supports photos, ratings, and reviews for automated testing.
14. Normal CI requires no Google credentials.
15. Restaurant recommendations continue to protect private participant preferences.
16. Ratings are treated as one Council evaluation signal rather than automatically determining the recommendation.

---

## 38. Desired End State

After restaurant discovery, the user should see something closer to a polished restaurant application:

```text
+------------------------------------------------+
|                                                |
|             [ Restaurant Photo ]               |
|                                                |
+------------------------------------------------+
| Fleming's Prime Steakhouse                     |
| ★ 4.6 (2,143)                         $$$      |
| Steakhouse • 2.3 miles                         |
|                                                |
| ✓ Fits the Council's dietary requirements      |
| ✓ Strong cuisine match                         |
| ✓ Within the negotiated price range            |
|                                                |
|              [ View Details ]                  |
+------------------------------------------------+
```

Opening the restaurant can show:

```text
[Photo] [Photo] [Photo]

Fleming's Prime Steakhouse
★ 4.6 (2,143)

Why the Council likes it
------------------------
Strong match for the group's cuisine, location,
dietary, and price preferences.

What diners are saying
----------------------
★★★★★
"Excellent food and service..."

★★★★☆
"Great steak and atmosphere..."
```

The result should combine real-world restaurant information with Restaurant Council's private multi-agent negotiation system without exposing the private reasons behind individual participants' preferences.
