# Restaurant Council — Natural Language / Agentic Event Creation Requirements

## 1. Overview

Add an optional AI-powered event creation path alongside the existing structured form. A user describes the desired restaurant event in free text; Restaurant Council interprets it into structured event data, resolves dates and locations, validates constraints, asks targeted clarification only when needed, presents a confirmation, and then uses the existing event creation service.

Example:

> I want to find a restaurant within 10 miles of Bamford Park in Broward County on Saturday at 3pm that is kid friendly.

The LLM interprets language. Deterministic application code validates and executes. The LLM must never directly write database state or invent trusted provider identifiers.

## 2. Goals

- Free-text event creation as an alternative to the form.
- Convert natural language into the existing event model.
- Resolve relative dates such as Saturday, tomorrow, and next Friday.
- Extract time, party size, radius, cuisine, dietary needs, price, atmosphere, and other constraints.
- Resolve named places through the existing location/provider infrastructure.
- Distinguish required constraints from preferences.
- Explicitly represent missing or ambiguous information.
- Ask only necessary follow-up questions.
- Support conversational edits before creation.
- Require structured confirmation before persistence.
- Preserve Restaurant Council privacy boundaries.
- Use typed tools suitable for future agent/MCP orchestration.

## 3. UX

```text
Create an Event

┌───────────────────────────────────────────────┐
│ ✨ Describe what you're looking for            │
│                                               │
│ "Find somewhere kid friendly within 10 miles  │
│  of Bamford Park Saturday at 3pm."            │
│                                               │
│                         [Continue]             │
└───────────────────────────────────────────────┘

                    OR

             [Use the form instead]
```

Both creation paths must ultimately use the same event creation domain service.

## 4. Architecture

```text
Natural Language
      │
      ▼
Event Creation Agent
      │
      ▼
Event Intent Parser (LLM)
      │
      ▼
Structured EventCreationIntent
      │
      ├── deterministic date/time validation
      ├── location resolution
      ├── constraint validation
      └── ambiguity detection
      │
      ▼
Clarification / Confirmation
      │
      ▼
Validated CreateEventCommand
      │
      ▼
Existing Event Creation Service
      │
      ▼
Database
```

## 5. Event Creation Intent

Use an intermediate model separate from the persisted Event entity.

```ts
export interface EventCreationIntent {
  eventType: "restaurant";
  title?: string;

  date?: string;
  time?: EventTimeIntent;
  partySize?: number;

  location?: EventLocationIntent;

  cuisines?: Preference<string>[];
  dietaryRequirements?: DietaryConstraint[];
  price?: PriceConstraint;
  requirements?: EventRequirement[];

  invitees?: InviteeIntent[];

  missingFields: MissingField[];
  ambiguities: EventAmbiguity[];

  source: "natural-language" | "form";
}
```

The intermediate intent may be incomplete. Only a validated canonical command may be persisted.

## 6. Location Intent

```ts
export interface EventLocationIntent {
  query: string;
  radiusMiles?: number;

  resolvedLocation?: {
    displayName: string;
    latitude: number;
    longitude: number;
    provider?: string;
    providerPlaceId?: string;
  };
}
```

The LLM extracts `"Bamford Park, Broward County, Florida"` as a query. The existing location provider resolves it. The LLM must not invent coordinates or provider IDs.

## 7. Example Parse

Input:

```text
I want to find a restaurant within 10 miles of Bamford Park
in Broward County on Saturday at 3pm that is kid friendly.
```

Result:

```json
{
  "eventType": "restaurant",
  "date": "2026-09-19",
  "time": {
    "time": "15:00",
    "approximate": false
  },
  "location": {
    "query": "Bamford Park, Broward County, Florida",
    "radiusMiles": 10
  },
  "requirements": [
    {
      "type": "kid-friendly",
      "strength": "required"
    }
  ],
  "missingFields": [],
  "ambiguities": [],
  "source": "natural-language"
}
```

The actual absolute date must be calculated from deterministic current-date and timezone context.

## 8. Relative Dates

Support:

```text
today
tomorrow
Saturday
this Saturday
next Saturday
next Friday
this weekend
Friday night
Saturday afternoon
```

Pass deterministic context into the parser:

```ts
export interface EventParserContext {
  currentDateTime: string;
  timezone: string;
}
```

Never rely on the model's internal notion of today's date.

## 9. Time Interpretation

Support:

```text
3pm
3:30
around 7
noon
lunch
dinner
Saturday night
early dinner
```

```ts
export interface EventTimeIntent {
  time?: string;
  approximate?: boolean;
  dayPart?:
    | "breakfast"
    | "lunch"
    | "afternoon"
    | "dinner"
    | "evening";
}
```

Do not invent an exact requested time from a broad daypart. Application logic may translate a daypart into a search window later.

## 10. Required vs Preferred

```ts
export type ConstraintStrength = "required" | "preferred";
```

Examples:

```text
"must have vegan options"
→ required

"one person is vegetarian"
→ required accommodation

"Italian would be nice"
→ preferred

"I'd prefer somewhere quiet"
→ preferred

"under $50 per person"
→ normally required

"I'd rather keep it under $50"
→ normally preferred
```

If ambiguity materially changes candidate elimination, represent it or ask the user rather than confidently guessing.

## 11. General Requirements

```ts
export interface EventRequirement {
  type: string;
  value?: unknown;
  strength: ConstraintStrength;
}
```

Examples:

```json
{ "type": "kid-friendly", "strength": "required" }
```

```json
{ "type": "outdoor-seating", "strength": "preferred" }
```

```json
{ "type": "quiet", "strength": "preferred" }
```

Keep requirement identifiers extensible.

## 12. Kid-Friendly

Normalize phrases such as:

```text
kid friendly
family friendly
good for children
somewhere I can take the kids
```

to a provider-neutral requirement.

If Google Places or another provider does not expose a reliable structured kid-friendly field, pass it into an evidence-based restaurant enrichment/analyzer stage. The event parser identifies the requirement; it does not claim restaurants satisfy it.

## 13. Price Intent

Support:

```text
cheap
inexpensive
nothing too expensive
under $30 per person
around $50 each
$$ or less
```

```ts
export interface PriceConstraint {
  maxPerPerson?: number;
  providerPriceLevels?: number[];
  description?: string;
  strength: ConstraintStrength;
}
```

Do not infer financial circumstances from a price preference.

## 14. Party Size

Extract explicit counts:

```text
for four people
party of 8
two adults and three kids
```

`two adults and three kids` can deterministically become `partySize = 5`.

Do not guess counts from ambiguous references.

## 15. Cuisine

```ts
export interface Preference<T> {
  value: T;
  strength: ConstraintStrength;
  polarity?: "include" | "exclude";
}
```

Examples:

```text
"Italian would be nice"
→ Italian / preferred / include

"no seafood"
→ seafood / required / exclude
```

## 16. Dietary Requirements

Reuse the existing Dietary Requirements & Evidence-Based Analysis models.

```text
"one person is vegetarian"
```

may become:

```json
{
  "requirement": "vegetarian",
  "strength": "required",
  "evidenceRequirement": "normal"
}
```

The creator need not identify which participant owns the requirement.

## 17. Participant-Specific Claims

If the creator says:

```text
Jessica is vegan.
```

do not persist this as Jessica's authenticated private preference.

Treat it as an event-level creator-supplied requirement for vegan accommodation. When Jessica joins, Jessica's Personal Agent remains authoritative for her private preferences.

## 18. Missing Fields

```ts
export interface MissingField {
  field: string;
  required: boolean;
  reason?: string;
}
```

Do not ask for values that can safely use application defaults.

Follow-up questions should be driven by structured missing fields, not unconstrained model curiosity.

## 19. Ambiguity

```ts
export interface EventAmbiguity {
  field: string;
  description: string;
  candidates?: unknown[];
}
```

Example:

```text
somewhere near the arena tomorrow
```

If location resolution finds several plausible arenas, ask which one. Do not let the LLM select one arbitrarily.

## 20. Conversational Modification

Initial request:

```text
Within 10 miles of Bamford Park Saturday at 3.
```

Follow-up:

```text
Actually make it 5 miles and 4pm.
```

Expected change:

```diff
-radiusMiles: 10
+radiusMiles: 5

-time: 15:00
+time: 16:00
```

Unmentioned fields must remain unchanged.

Suggested API:

```ts
export interface EventCreationAgent {
  interpret(input: EventCreationInput): Promise<EventCreationResult>;

  modify(
    current: EventCreationIntent,
    input: string
  ): Promise<EventCreationResult>;
}
```

## 21. Confirmation

Before persistence, show a deterministic summary generated from the structured intent:

```text
Here's what I understood:

Saturday, September 19
3:00 PM

📍 Within 10 miles of Bamford Park
   Broward County, Florida

Requirements
✓ Kid friendly

[Create Event]    [Make Changes]

[Edit using form]
```

Require explicit confirmation.

## 22. Form Interoperability

Natural language and the form should share the same intermediate model:

```text
Natural language
      ↓
EventCreationIntent
      ↓
Form / Conversation
      ↓
Validated CreateEventCommand
      ↓
Event service
```

Users should be able to parse free text and then open the result in the form for manual editing.

## 23. LLM Structured Output

```ts
export interface EventIntentParser {
  parse(
    text: string,
    context: EventParserContext
  ): Promise<EventCreationIntent>;
}
```

Use schema-constrained structured output and runtime validation.

LLM output is always untrusted input.

## 24. Deterministic Validation

Application code must validate:

- date
- time
- timezone
- radius bounds
- party-size bounds
- price values
- requirement representation
- location resolution
- real provider identifiers
- invitee values
- authentication
- authorization
- existing event invariants

The model cannot override validation.

## 25. Agent Tools

Initial typed tools:

```text
parse_event_intent
resolve_location
validate_event_intent
create_event
```

Future tools:

```text
search_restaurants
analyze_dietary_accommodation
analyze_restaurant_requirement
check_restaurant_availability
invite_participants
```

Every state-changing tool independently enforces authorization.

## 26. resolve_location Tool

```ts
export interface ResolveLocationInput {
  query: string;
}

export interface ResolveLocationOutput {
  status: "resolved" | "ambiguous" | "not-found";
  location?: ResolvedLocation;
  candidates?: ResolvedLocation[];
}
```

The agent must never manufacture a successful resolution.

## 27. validate_event_intent Tool

```ts
export interface ValidateEventIntentInput {
  intent: EventCreationIntent;
}

export interface ValidateEventIntentOutput {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
```

This is deterministic application logic.

## 28. create_event Tool

`create_event` accepts only a validated canonical command.

Requirements:

- authenticated user
- authorization check
- schema validation
- normal domain invariants
- idempotency protection where appropriate
- safe audit metadata

Never pass raw natural language directly to the persistence layer.

## 29. Invitations

Optional initial/future support:

```text
Invite Sarah at sarah@example.com.
Invite Mike at 555-555-1234.
```

```ts
export interface InviteeIntent {
  displayName?: string;
  email?: string;
  phone?: string;
}
```

Parsing an invitee must not send an invitation. Display invitees at confirmation and send only after explicit confirmation.

## 30. Privacy

Natural-language prompts may contain private explanations.

Example:

```text
Money is tight, so I'd like to stay under $30,
but don't tell everyone that.
```

Extract the operational constraint:

```json
{
  "maxPerPerson": 30,
  "strength": "preferred"
}
```

Do not propagate the private explanation to:

- other participants
- restaurant providers
- event descriptions
- normal logs/analytics
- the Negotiator when the reason is unnecessary

Likewise, voluntarily supplied medical or other sensitive reasons should be reduced to the minimum operational requirement.

## 31. Raw Prompt Retention

Avoid indefinite raw-prompt storage by default.

Prefer storing:

- normalized intent
- safe audit metadata
- parser/schema version
- validation outcome

If raw prompts are retained for debugging, define an explicit retention policy and keep them out of normal logs.

## 32. AI Provider Abstraction

Do not tightly couple the feature to one model vendor.

```ts
export interface StructuredAIProvider {
  generateStructured<T>(
    request: StructuredAIRequest<T>
  ): Promise<T>;
}
```

The parser depends on an application-level AI abstraction.

Version parser contracts, e.g.:

```text
event-intent-parser:v1
```

Record non-sensitive diagnostics such as model/provider ID, schema version, duration, and validation result.

## 33. Security

- Treat LLM output as untrusted.
- Validate every structured result.
- Never execute arbitrary model-generated code.
- Never trust model-generated coordinates/provider IDs.
- Never let AI bypass authentication or authorization.
- Never expose provider/API secrets in prompts.
- Clamp numeric values.
- Rate-limit AI endpoints.
- Apply input-length/abuse limits.
- Treat future retrieved external content as untrusted.
- State changes occur only through authorized typed tools/services.

## 34. Error Handling

Handle:

- LLM timeout
- malformed output
- unavailable AI provider
- invalid/ambiguous relative date
- invalid time
- location not found
- multiple location matches
- unsupported/unknown requirement
- invalid radius
- hallucinated provider ID
- validation failure
- event creation failure

If AI interpretation fails, preserve the user's entered text in the active UI and offer the structured form.

## 35. Observability

Track:

```text
event_nl_creation_started
event_nl_parse_success
event_nl_parse_failure
event_nl_followup_required
event_nl_location_ambiguous
event_nl_confirmation_shown
event_nl_confirmed
event_nl_abandoned
event_nl_modified
event_nl_fallback_to_form
event_nl_parse_latency
```

Do not put raw prompts or private explanations in normal metrics/logs.

## 36. Testing

### Parser Fixtures

Cover:

- explicit date/time/location
- relative dates
- approximate times
- radius
- party size
- kid-friendly
- cuisine preference
- cuisine exclusion
- price preference
- hard price limit
- dietary requirement
- multiple constraints
- missing location
- ambiguous location
- participant-specific claim
- private explanation

### Golden Test

Input:

```text
I want a restaurant within 10 miles of Bamford Park
in Broward County on Saturday at 3pm that is kid friendly.
```

Verify:

- restaurant event
- Saturday resolves correctly from supplied current-date context
- time = 15:00
- Bamford Park query preserved
- radius = 10 miles
- kid-friendly required
- no invented coordinates/provider IDs

### Modification Test

Initial:

```text
Saturday at 3 within 10 miles of Bamford Park.
```

Modification:

```text
Actually make it 5 miles and 4.
```

Verify only radius/time change.

### Privacy Test

Input:

```text
Money is tight. Keep it under $30 but don't tell everyone.
```

Verify:

- price constraint extracted
- explanation is not propagated
- explanation absent from Negotiator payload
- explanation absent from normal logs

### Security Tests

Verify:

- malformed model output rejected
- fake provider IDs rejected
- invalid dates rejected
- extreme radius rejected/clamped
- unauthorized create fails
- prompt injection cannot bypass validation

## 37. Mock Parser

Provide a deterministic implementation for CI:

```ts
export class MockEventIntentParser
  implements EventIntentParser {
  // fixture-based implementation
}
```

Normal CI must not require a live LLM.

Maintain representative natural-language examples as regression fixtures.

## 38. Implementation Phases

### Phase 1 — Intent Domain Model
Implement intent, location, requirements/preferences, missing fields, ambiguities, and runtime schemas.

### Phase 2 — Intent Parser
Implement structured AI output, parser context, relative date handling, basic constraint extraction, and tests.

### Phase 3 — Location Resolution
Connect parsed location queries to the existing location provider and support resolved/ambiguous/not-found states.

### Phase 4 — Validation
Implement deterministic validation and conversion into the existing canonical event creation command.

### Phase 5 — Confirmation UI
Implement interpreted summary, Create Event, Make Changes, and Edit Using Form.

### Phase 6 — Conversational Modification
Allow follow-up text to modify the current intent without losing unchanged fields.

### Phase 7 — Clarification
Generate targeted questions from missing fields and ambiguities.

### Phase 8 — Advanced Constraints
Add dietary, price, cuisine, kid-friendly, atmosphere, accessibility, and other evidence-backed requirements.

### Phase 9 — Invitations
Optionally parse invitees and connect them to the existing invitation workflow after confirmation.

## 39. Acceptance Criteria

1. Users can choose natural-language creation instead of the form.
2. The Bamford Park example produces the expected structured intent.
3. Relative dates use supplied current-date/timezone context.
4. Named locations resolve through the location provider.
5. AI never invents trusted coordinates/provider IDs.
6. Radius, date, time, party size, cuisine, dietary, price, and general constraints can be extracted.
7. Required vs preferred constraints are represented.
8. Kid-friendly can be represented as a requirement.
9. Missing information is explicit.
10. Ambiguous locations trigger clarification rather than guessing.
11. Users can conversationally modify intents.
12. Unmentioned fields survive modifications.
13. A structured confirmation appears before creation.
14. Users can switch to/edit with the structured form.
15. Both paths use the same underlying event service.
16. LLM output is schema validated.
17. State changes occur only through deterministic authorized tools/services.
18. Private explanations are reduced to minimum operational constraints.
19. Other participants do not receive private prompt content.
20. Normal CI works without a live LLM.
21. Parser regression fixtures exist.
22. AI/provider failure gracefully falls back to the form.
23. Architecture supports future tool/MCP orchestration.

## 40. Desired End State

The user enters:

```text
I want to find a restaurant within 10 miles of Bamford Park
in Broward County on Saturday at 3pm that is kid friendly.
```

Restaurant Council parses the request, resolves Bamford Park through the location provider, validates the date/time, and displays:

```text
Here's what I understood

Saturday, September 19
3:00 PM

Within 10 miles of
Bamford Park
Broward County, Florida

Requirements
✓ Kid friendly

[Create Event]    [Make Changes]

[Edit using form]
```

The user says:

```text
Actually make it 5 miles and 4pm.
```

The structured intent updates without losing other fields.

After explicit confirmation, the Event Creation Agent calls the validated event-creation tool/service.

The result is an AI-first event creation experience while preserving Restaurant Council's deterministic domain logic, provider abstractions, authorization boundaries, and private multi-agent architecture.
