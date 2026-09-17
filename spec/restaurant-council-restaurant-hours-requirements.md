# Restaurant Council --- Restaurant Hours & Event-Time Suitability Requirements

## Overview

Add deterministic restaurant-hours validation so Restaurant Council does
not recommend restaurants that are closed or too close to closing at the
event time.

The initial business rule is:

> A restaurant must be open at the event start time and remain open for
> **at least 60 minutes after the event start time**.

Missing hours must produce `unknown`, not `closed`.

## Goals

-   Retrieve restaurant hours from the restaurant provider, initially
    Google Places.
-   Evaluate hours against the event's actual date, time, and location
    timezone.
-   Require at least 60 minutes of remaining open time by default.
-   Handle split schedules, overnight hours, 24-hour restaurants,
    special/current hours, and missing hours.
-   Filter clearly unsuitable restaurants before expensive AI/Council
    analysis.
-   Surface explainable closing-time information in the UI.
-   Integrate uncertain hours with the human-verification workflow.
-   Keep the hours model provider-neutral.
-   Make the 60-minute minimum configurable for future events.

## Core Business Rule

Centralize the default:

``` ts
export const DEFAULT_MINIMUM_OPEN_AFTER_EVENT_MINUTES = 60;
```

A restaurant is suitable only if one opening period:

1.  contains the event start time; and
2.  extends through `eventStart + minimumOpenAfterEventMinutes`.

Examples:

``` text
Event: 3:00 PM
Restaurant closes: 10:00 PM
Required through: 4:00 PM
→ SUITABLE
```

``` text
Event: 3:00 PM
Restaurant closes: 3:30 PM
Required through: 4:00 PM
→ CLOSES_TOO_SOON
```

Closing exactly 60 minutes after the event starts is acceptable:

``` text
Event: 3:00 PM
Close: 4:00 PM
→ SUITABLE
```

## Domain Model

``` ts
export interface RestaurantHoursAssessment {
  restaurantId: string;

  status:
    | "suitable"
    | "closes-too-soon"
    | "closed"
    | "unknown";

  eventDateTime: string;
  minimumOpenAfterEventMinutes: number;
  requiredOpenUntil: string;

  applicablePeriod?: {
    opensAt: string;
    closesAt?: string;
  };

  source?: {
    provider: string;
    retrievedAt: string;
    type?: "current" | "regular" | "human";
  };
}
```

Semantics:

-   `suitable` --- open at event start and remains open for the required
    duration.
-   `closes-too-soon` --- open at event start but closes before the
    required duration.
-   `closed` --- not open at event start.
-   `unknown` --- reliable hours are unavailable.

## Provider-Neutral Hours Model

Normalize provider data before evaluation:

``` ts
export interface RestaurantHours {
  periods: RestaurantOpeningPeriod[];

  source: {
    provider: string;
    retrievedAt: string;
    type?: "current" | "regular" | "human";
  };
}

export interface RestaurantOpeningPeriod {
  opensAt: string;
  closesAt?: string;
}
```

Use timezone-aware timestamps internally. Core Council logic must not
understand Google-specific weekday/time structures.

## Google Places Integration

Use Google Places as the initial structured hours provider. Normalize
relevant opening-hours data such as:

``` text
currentOpeningHours
regularOpeningHours
```

Prefer current/special hours when they cover the event date. Use regular
hours as an appropriate fallback.

Conceptually:

``` text
Google Places
     ↓
GooglePlacesRestaurantProvider
     ↓
RestaurantHours
     ↓
RestaurantHoursEvaluator
```

For events outside the reliable current/special-hours horizon, avoid
overstating certainty. For example:

``` text
Expected to be open until 10 PM
Based on regular hours
```

is preferable to claiming the future schedule is definitively confirmed.

## Deterministic Evaluator

``` ts
export interface RestaurantHoursEvaluator {
  evaluate(
    hours: RestaurantHours | undefined,
    eventDateTime: string,
    options?: RestaurantHoursEvaluationOptions
  ): RestaurantHoursAssessment;
}

export interface RestaurantHoursEvaluationOptions {
  minimumOpenAfterEventMinutes?: number;
}
```

Default `minimumOpenAfterEventMinutes` to 60.

Conceptual logic:

``` ts
const requiredOpenUntil =
  addMinutes(eventStart, minimumOpenAfterEventMinutes);

if (!hours) return UNKNOWN;

const period = findOpeningPeriodContaining(eventStart);

if (!period) return CLOSED;

if (!period.closesAt) return SUITABLE;

if (period.closesAt >= requiredOpenUntil) {
  return SUITABLE;
}

return CLOSES_TOO_SOON;
```

No LLM should be used for this calculation.

## Split Schedules

Evaluate each opening period independently.

``` text
Saturday:
11:00 AM – 2:30 PM
5:00 PM – 10:00 PM

Event: 2:00 PM
Required through: 3:00 PM
→ CLOSES_TOO_SOON
```

Do not combine the lunch and dinner periods.

At 3:00 PM the same restaurant is:

``` text
→ CLOSED
```

even though it reopens later.

## Overnight Hours

Support real datetime intervals:

``` text
Friday:
5:00 PM – 2:00 AM Saturday

Event:
Friday 11:30 PM

Required through:
Saturday 12:30 AM

→ SUITABLE
```

Do not compare naive clock strings.

## 24-Hour Restaurants

A restaurant represented as continuously open should satisfy the
duration rule without requiring an artificial closing time.

## Timezones

Evaluate using the restaurant/event location timezone, preferably an
IANA timezone such as:

``` text
America/New_York
```

Do not assume browser, server, or UTC time. Use timezone-aware date/time
handling so DST and overnight periods work correctly.

## Unknown Hours

Missing provider hours mean:

``` text
UNKNOWN
```

not:

``` text
CLOSED
```

An unknown restaurant may remain under consideration and can be
escalated for additional evidence or human verification.

Example:

``` text
Saturday hours
? Could not verify

This restaurant otherwise matches the event.

[I'll verify]   [Discuss]
```

## Human Verification

Integrate with the existing human-in-the-loop feature.

A participant may call and report:

``` text
They said the kitchen is open until 10 PM Saturday.
```

Record this as time-stamped evidence, for example:

``` text
requirementType: "opening-hours"
method: "phone"
```

Do not silently overwrite provider data. Preserve who verified it, how,
and when.

If official/provider evidence conflicts with recent human evidence,
retain the conflict and apply the project's evidence-authority/freshness
rules rather than hiding it.

## Candidate Pipeline

Hours validation should happen before expensive AI evaluation where
practical:

``` text
Google Places discovery
        ↓
40–100 candidates
        ↓
Cheap deterministic filtering
        ↓
10–20 plausible candidates
        ↓
Hours enrichment
        ↓
Hours evaluation
        ├── CLOSED → eliminate
        ├── CLOSES_TOO_SOON → eliminate
        ├── UNKNOWN → retain + flag
        └── SUITABLE → retain
        ↓
Dietary / kid-friendly / other analysis
        ↓
Council evaluation
        ↓
Finalists
```

Candidate counts are illustrative.

## Cost and Progressive Enrichment

Do not request higher-cost provider fields for every discovery result if
progressive enrichment is more economical.

Support:

``` text
basic discovery
→ cheap filtering
→ hours enrichment for plausible candidates
```

Cache hours separately from stable restaurant identity data, subject to
provider rules. Store `retrievedAt` and schedule type. Current/special
hours should generally have a shorter useful lifetime than stable
identity fields.

## Event Configuration

Design the policy so the 60-minute value is configurable:

``` ts
export interface EventRestaurantSearchPolicy {
  minimumOpenAfterEventMinutes: number;
}
```

Initial default:

``` json
{
  "minimumOpenAfterEventMinutes": 60
}
```

Future natural-language input should be able to override it:

``` text
Make sure the restaurant is open for at least
two hours after we arrive.
```

→

``` json
{
  "minimumOpenAfterEventMinutes": 120
}
```

If no duration is specified, use 60.

## Natural-Language Event Creation Integration

For:

``` text
Find a restaurant near Bamford Park Saturday at
3 PM that stays open for at least two hours after we arrive.
```

the Event Creation Agent may produce:

``` json
{
  "time": "15:00",
  "restaurantSearchPolicy": {
    "minimumOpenAfterEventMinutes": 120
  }
}
```

The LLM extracts the user's intent; deterministic hours code performs
the actual evaluation.

## Candidate UI

Suitable:

``` text
Saturday
Open until 10:00 PM

✓ Open for the event
✓ More than 1 hour before closing
```

Boundary:

``` text
Open until 4:00 PM

✓ Meets the minimum
Closes 1 hour after the 3:00 PM event start
```

Closes too soon:

``` text
Open until 3:30 PM

✗ Closes too soon

The event starts at 3:00 PM and Restaurant Council
requires the restaurant to remain open until at least 4:00 PM.
```

Unknown:

``` text
Saturday hours
? Could not verify

[I'll verify]   [Discuss]
```

## Explainability

Generate deterministic explanations from structured values:

``` text
Why wasn't this restaurant recommended?

It closes at 7:30 PM.
Your event starts at 7:00 PM, and Restaurant Council
requires at least 60 minutes before closing.
```

No LLM is required.

## Hours vs Reservations

Keep these concepts separate:

``` text
OPEN
≠
TAKES RESERVATIONS
≠
HAS RESERVATION AVAILABILITY
```

Do not infer reservation availability from opening hours.

Reservation-link discovery remains a separate capability.

## Related Google Restaurant Attributes

The provider adapter may normalize other useful structured attributes
when available, including concepts such as:

``` text
reservable
goodForChildren
goodForGroups
menuForChildren
```

These are outside the core hours evaluator.

Missing provider attributes must not automatically become `false` unless
the provider explicitly defines that behavior.

## Failure Handling

Handle:

-   missing hours;
-   malformed provider periods;
-   invalid event datetime;
-   unknown timezone;
-   provider failure;
-   stale cached hours;
-   conflicting evidence;
-   event date beyond special/current-hours horizon;
-   split schedules;
-   overnight schedules;
-   24-hour schedules.

Prefer `unknown` over unsupported certainty.

## Observability

Track metrics such as:

``` text
restaurant_hours_requested
restaurant_hours_cache_hit
restaurant_hours_cache_miss
restaurant_hours_suitable
restaurant_hours_closed
restaurant_hours_closes_too_soon
restaurant_hours_unknown
restaurant_hours_provider_failure
restaurant_hours_human_verification_requested
```

Do not log unnecessary private participant/event information.

## Unit Tests

Required cases:

``` text
Event 3:00 PM, closes 10:00 PM, minimum 60
→ suitable

Event 3:00 PM, closes 4:00 PM, minimum 60
→ suitable

Event 3:00 PM, closes 3:59 PM, minimum 60
→ closes-too-soon

Event 3:00 PM, closes 2:00 PM
→ closed

Event 3:00 PM, opens 5:00 PM
→ closed

Split: 11–2:30 and 5–10
Event 2:00 PM, minimum 60
→ closes-too-soon

Friday 5 PM – Saturday 2 AM
Event Friday 11:30 PM, minimum 60
→ suitable

Close Saturday 12:15 AM
Event Friday 11:30 PM, minimum 60
→ closes-too-soon

24-hour restaurant
→ suitable

Missing hours
→ unknown

Event 7 PM, closes 8:30 PM, minimum 120
→ closes-too-soon
```

## Integration Tests

Verify:

1.  Google/provider hours normalize correctly.
2.  Current/special hours are preferred when applicable.
3.  Regular hours provide fallback when appropriate.
4.  `closed` candidates are eliminated.
5.  `closes-too-soon` candidates are eliminated.
6.  `unknown` candidates remain eligible for investigation.
7.  Explanations contain the correct event/closing times.
8.  Human verification can be requested for unknown hours.
9.  Provider failure never incorrectly means closed.
10. Event location timezone is used.

## Mock Provider

Extend mock fixtures with:

``` text
open
exact 60-minute boundary
closes too soon
closed
split hours
overnight
24-hour
unknown
```

Normal CI must not require Google credentials.

## Implementation Phases

### Phase 1 --- Domain Model

Implement normalized hours, opening periods, assessment model, policy,
and runtime schemas.

### Phase 2 --- Evaluator

Implement deterministic timezone-aware hours evaluation and unit tests.

### Phase 3 --- Google Normalization

Normalize Google current/regular opening-hours data.

### Phase 4 --- Candidate Pipeline

Insert hours enrichment and filtering before expensive Council analysis.

### Phase 5 --- UI

Show closing times, suitability, closes-too-soon explanations, and
unknown states.

### Phase 6 --- Human Verification

Connect unknown/conflicting hours to the existing verification workflow.

### Phase 7 --- Natural-Language Configuration

Allow the event creator to override the default 60-minute minimum.

## Acceptance Criteria

1.  Google Places hours can be normalized into a provider-neutral model.
2.  Hours evaluation is deterministic.
3.  Restaurant must be open at event start.
4.  Default required remaining-open duration is 60 minutes.
5.  Closing exactly 60 minutes after event start is accepted.
6.  Closing 59 minutes after event start is `closes-too-soon`.
7.  Closed restaurants are rejected.
8.  Split periods are evaluated independently.
9.  Overnight periods work correctly.
10. 24-hour restaurants work correctly.
11. Missing hours produce `unknown`.
12. Current/special hours are preferred when applicable.
13. Regular hours may provide fallback.
14. Far-future regular hours do not receive overstated certainty.
15. Correct location timezone is used.
16. Closed/closes-too-soon candidates are filtered before expensive AI
    analysis where practical.
17. Unknown candidates can proceed to human verification.
18. Users can see why a restaurant failed the hours rule.
19. The 60-minute policy is centralized/configurable.
20. Provider-specific hours structures do not leak into the core
    evaluator.
21. CI works with mock data and no Google credentials.
22. Opening-hours suitability remains separate from reservation status
    and availability.

## Desired End State

For an event Saturday at 3:00 PM:

``` text
Restaurant A
Saturday: 11 AM – 10 PM
Required through: 4 PM
✓ Suitable
```

``` text
Restaurant B
Saturday: 11 AM – 3:30 PM
Required through: 4 PM
✗ Closes too soon
```

Restaurant B is removed before expensive Council analysis.

``` text
Restaurant C
Saturday hours unavailable
? Could not verify
```

Restaurant C remains eligible but is flagged. If it otherwise becomes a
strong candidate, Restaurant Council can ask a participant to verify the
hours.

The result is an explainable, deterministic hours filter that prevents
recommendations immediately before closing while preserving uncertainty
when reliable data is unavailable.
