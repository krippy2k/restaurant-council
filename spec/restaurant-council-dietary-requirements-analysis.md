# Restaurant Council — Dietary Requirements & Evidence-Based Analysis

## 1. Overview

Restaurant Council already discovers real restaurants through Google Places. Google provides some structured restaurant attributes, but it does not expose structured fields for many dietary needs such as dairy-free, gluten-free, nut-free, or allergy accommodation.

Add an evidence-based Dietary Analyzer that investigates whether restaurant candidates can satisfy dietary requirements using structured provider data, official restaurant websites and menus, allergen information, and—when stronger sources are unavailable—review evidence.

The system must never let an LLM simply guess that a restaurant accommodates a dietary need. Conclusions must be evidence-backed, explicitly uncertain when evidence is insufficient, and compatible with Restaurant Council's existing private-agent architecture.

## 2. Goals

- Support dietary requirements beyond Google Places' structured attributes.
- Support dairy-free, gluten-free, vegetarian, vegan, nut-free, peanut-free, shellfish-free, egg-free, soy-free, halal, kosher, and future requirements.
- Distinguish preferences from requirements.
- Allow stricter evidence requirements without requiring users to disclose why.
- Gather evidence from authoritative restaurant sources.
- Produce structured, explainable assessments.
- Track evidence supporting each conclusion.
- Represent uncertainty and conflicting information explicitly.
- Integrate dietary analysis into candidate filtering and Council evaluation.
- Perform expensive investigation only on plausible candidates.
- Preserve private participant motivations.

## 3. Dietary Constraints

Use extensible requirement identifiers:

```ts
export type DietaryRequirementId = string;

export type DietaryConstraintStrength =
  | "preferred"
  | "required";

export type DietaryEvidenceRequirement =
  | "normal"
  | "strict";

export interface DietaryConstraint {
  requirement: DietaryRequirementId;
  strength: DietaryConstraintStrength;
  evidenceRequirement?: DietaryEvidenceRequirement;
}
```

Examples:

```text
"I prefer dairy-free dishes"
→ dairy-free / preferred / normal

"I need dairy-free options"
→ dairy-free / required / normal

"I need you to be very strict about dairy-free accommodation"
→ dairy-free / required / strict
```

Do not infer a medical diagnosis or allergy from a dietary constraint.

## 4. Dietary Assessment

```ts
export interface DietaryAssessment {
  restaurantId: string;
  requirement: DietaryRequirementId;

  status:
    | "confirmed"
    | "likely"
    | "uncertain"
    | "unsupported"
    | "conflicting";

  confidence: number;
  evidence: DietaryEvidence[];
  analyzedAt: string;
  expiresAt?: string;
}
```

The status should drive application behavior. `confidence` may be normalized from 0–1 and used internally for ranking/debugging, but should not be presented as a medical-safety probability.

## 5. Evidence Model

```ts
export interface DietaryEvidence {
  id: string;

  sourceType:
    | "structured-provider"
    | "official-allergen-info"
    | "official-menu"
    | "official-website"
    | "restaurant-statement"
    | "menu-provider"
    | "review"
    | "other";

  sourceUrl?: string;
  sourceName?: string;
  observedAt?: string;
  excerpt?: string;

  supports:
    | "supports"
    | "contradicts"
    | "neutral";

  reliability:
    | "high"
    | "medium"
    | "low";

  scope?: "location" | "chain" | "unknown";
}
```

Store only short excerpts needed to explain the evidence. Do not copy large amounts of copyrighted menu, website, or review text.

## 6. Evidence Hierarchy

Default evidence priority:

```text
1. Structured provider attribute that directly answers the requirement
2. Official restaurant allergen information
3. Official restaurant menu
4. Official restaurant website/statement
5. Trusted structured menu provider
6. Restaurant reviews
7. Other evidence
```

Examples:

```text
Official allergen/menu page explicitly identifies dairy-free items
→ potentially CONFIRMED

Official menu explicitly labels vegan dishes
→ strong evidence that those dishes contain no dairy
→ does not automatically prove strict cross-contact accommodation

Multiple recent reviews describe dairy-free substitutions
→ potentially LIKELY

One old review mentions dairy-free accommodation
→ weak evidence; generally UNCERTAIN or low-confidence LIKELY

Nothing found
→ UNCERTAIN
```

## 7. Missing Evidence Is Not Negative Evidence

This is a hard requirement.

If no evidence can be found:

```text
status = uncertain
```

Do not return `unsupported` merely because Google, the restaurant website, or reviews do not mention the requirement.

`unsupported` requires affirmative evidence indicating that the restaurant does not provide a viable accommodation.

## 8. Conflicting Evidence

Evidence may disagree.

Example:

```text
Official restaurant information:
"We cannot accommodate gluten-free preparation."

Recent review:
"They made my meal gluten free."
```

Return:

```text
status = conflicting
```

Do not silently choose one source. Source authority and freshness may affect confidence, but the contradiction should remain visible.

## 9. Structured Provider Data

Use Google Places structured attributes when they directly answer a requirement.

Do not invent fields Google does not provide.

For example, the absence of a Google `dairy-free` attribute means:

```text
Google did not provide this information.
```

It must not become:

```ts
dairyFree: false
```

Normalize provider-supported attributes into Restaurant Council's provider-neutral model.

## 10. Dietary Analyzer Service

Introduce:

```ts
export interface DietaryAnalyzer {
  analyze(
    restaurant: Restaurant,
    request: DietaryAnalysisRequest
  ): Promise<DietaryAssessment[]>;
}

export interface DietaryAnalysisRequest {
  requirements: DietaryRequirementId[];
  evidenceRequirement?: DietaryEvidenceRequirement;
}
```

The analyzer orchestrates evidence collection and reasoning and must not be coupled directly to Google Places.

## 11. Analysis Pipeline

```text
Restaurant Candidate
       |
       v
Structured Provider Evidence
       |
       v
Official Restaurant / Allergen Evidence
       |
       v
Menu Evidence
       |
       v
Review Evidence (only if useful)
       |
       v
Dietary Analyzer
       |
       v
DietaryAssessment
```

Stop gathering evidence when sufficiently authoritative information already answers the question.

## 12. Progressive Analysis

Do not deeply research every Google search result.

```text
Google Places
    |
    v
40–100 candidates
    |
    v
Deterministic filtering
    |
    v
10–20 plausible candidates
    |
    v
Basic dietary evidence
    |
    v
5–8 candidates
    |
    v
Deep dietary analysis
    |
    v
3–5 finalists
```

This limits latency, AI cost, external requests, and unnecessary analysis.

## 13. Agent Tool

Expose:

```text
analyze_dietary_accommodation
```

Suggested input:

```ts
interface AnalyzeDietaryAccommodationInput {
  restaurantId: string;
  requirements: DietaryRequirementId[];
  evidenceRequirement?: "normal" | "strict";
}
```

Output:

```ts
interface AnalyzeDietaryAccommodationOutput {
  assessments: DietaryAssessment[];
}
```

Agents should consume these structured assessments instead of independently inventing dietary claims.

## 14. Evidence Collection Tools

The analyzer may internally use tools such as:

```text
get_restaurant_details
get_restaurant_website
find_restaurant_menu
read_restaurant_menu
find_allergen_information
search_restaurant_reviews
```

Keep evidence collection separate from final assessment so future tools, providers, or MCP servers can be added cleanly.

## 15. Official Website Analysis

When the restaurant's official website is known, prioritize targeted pages such as:

```text
Menu
Allergen Information
Nutrition
FAQ
Dietary Accommodations
Vegan / Vegetarian Menu
Gluten-Free Menu
```

Avoid crawling the entire website when targeted retrieval is sufficient.

## 16. Menu Analysis

Recognize explicit evidence such as:

```text
DF / dairy-free markers
GF / gluten-free markers
vegan labels
vegetarian labels
allergen legends
ingredient lists
substitution statements
cross-contact warnings
```

Do not infer that a dish is dairy-free simply because dairy is not obvious from its name.

For example:

```text
"Grilled salmon with vegetables"
```

is not sufficient evidence; butter, sauce, or preparation may contain dairy.

## 17. Vegan Evidence for Dairy-Free

An explicitly vegan dish is strong evidence that the dish itself contains no dairy.

However:

```text
vegan dish
```

does not establish:

```text
safe for strict dairy avoidance or allergy
```

because preparation and cross-contact can differ.

The analyzer may use vegan labeling as evidence of dairy-free food availability while separately evaluating strict accommodation.

## 18. Review Evidence

Reviews may supplement stronger sources when authoritative information is insufficient.

Relevant review evidence may discuss:

- dairy-free options
- gluten-free menus
- vegan substitutions
- dietary accommodation
- staff handling of restrictions
- cross-contact concerns

Reviews generally have lower reliability than official restaurant information. Recent reviews should generally carry more weight than old reviews because menus and policies change.

A single review should rarely result in `confirmed`.

## 19. Restaurant Chains

Distinguish:

```text
chain-wide evidence
```

from:

```text
location-specific evidence
```

Corporate allergen information may apply broadly, but local menus and preparation practices can differ.

For strict requirements, prefer location-specific evidence whenever available.

## 20. Required Constraint Behavior

Suggested default:

```text
CONFIRMED
→ keep candidate

LIKELY
→ keep for normal requirements
→ flag or investigate further for strict requirements

UNCERTAIN
→ do not claim requirement is satisfied
→ investigate further when candidate remains promising

UNSUPPORTED
→ eliminate when the constraint is required

CONFLICTING
→ flag and investigate further
```

Do not automatically discard every uncertain restaurant before attempting deeper analysis if doing so would eliminate otherwise plausible candidates.

## 21. Preferred Constraint Behavior

For `strength = preferred`, dietary support contributes to ranking rather than automatic exclusion.

Example:

```text
Restaurant A — dairy-free CONFIRMED
Restaurant B — dairy-free LIKELY
Restaurant C — dairy-free UNCERTAIN
```

A should receive a stronger dietary-fit signal, but other Council preferences still matter.

## 22. Strict Evidence Behavior

For:

```text
evidenceRequirement = strict
```

require stronger evidence.

Conceptually:

```text
Official allergen/menu documentation
→ strong evidence

Official restaurant statement
→ potentially strong evidence

Multiple reviews
→ supporting evidence only

LLM inference from dish descriptions
→ insufficient

No information
→ uncertain
```

Restaurant Council must not present a restaurant as medically safe.

Prefer:

```text
"The restaurant's published allergen information identifies dairy-free options."
```

Never:

```text
"This restaurant is safe for your allergy."
```

## 23. Privacy

Private input might be:

```text
"I absolutely cannot have dairy. Please don't tell everyone why."
```

The Personal Agent should reduce that to the minimum useful constraint:

```json
{
  "requirement": "dairy-free",
  "strength": "required",
  "evidenceRequirement": "strict"
}
```

The Negotiator does not need the reason.

Other participants may see:

```text
Meets the group's dietary requirements
```

They must not see:

```text
Sarah has a dairy allergy.
```

Do not send participant names, medical explanations, private preference text, or event-member identities to restaurant/evidence providers when unnecessary.

## 24. Recommendation Explanation

Final UI can show:

```text
Dietary compatibility

✓ Vegetarian options confirmed
✓ Dairy-free dishes identified on the official menu
? Nut-free accommodation could not be verified
```

Allow source inspection when available:

```text
View menu
View allergen information
View source
```

Do not reveal which participant requested an accommodation.

## 25. Confidence UI

Prefer human-readable states:

```text
Confirmed
Likely
Uncertain
Not supported
Conflicting information
```

Do not display:

```text
Dairy-free: 82% safe
```

The numeric confidence is an internal analysis/ranking signal, not a safety probability.

## 26. Freshness

Dietary information becomes stale as menus and policies change.

Store:

```ts
analyzedAt: string;
expiresAt?: string;
```

Evidence should record observation/publication dates when available.

Cached assessments must expire. Strict requirements should use appropriately conservative freshness rules and may trigger revalidation before final recommendation.

## 27. Persistence

Suggested tables:

```text
dietary_assessments
----------------------------
id
restaurant_id
requirement
status
confidence
analyzed_at
expires_at
created_at
updated_at
```

```text
dietary_evidence
----------------------------
id
assessment_id
source_type
source_url
source_name
supports
reliability
scope
excerpt
observed_at
created_at
```

Do not associate reusable restaurant evidence with the participant who caused the analysis.

The persisted question is:

```text
Does restaurant X support dairy-free dining?
```

not:

```text
Does restaurant X satisfy Sarah's condition?
```

## 28. Caching

Reuse fresh assessments by:

```text
restaurantId + dietaryRequirement + evidence mode
```

Do not reuse stale assessments indefinitely.

This allows expensive dietary research to be shared across events without sharing participant-private information.

## 29. Failure Handling

Handle:

- no restaurant website
- no menu found
- inaccessible menu
- PDF/image menu
- no reviews
- conflicting information
- stale information
- website timeout
- source failure
- LLM/tool failure
- no dietary information found

Ambiguity should resolve to:

```text
uncertain
```

rather than an invented conclusion.

## 30. LLM Requirements

If an LLM classifies evidence:

- Provide only retrieved evidence.
- Require structured output.
- Require evidence IDs for conclusions.
- Validate output against a schema.
- Reject references to nonexistent evidence.
- Prevent unsupported claims.
- Preserve uncertainty and conflicts.
- Use low-creativity classification settings.
- Separate retrieval from reasoning.

Example:

```json
{
  "requirement": "dairy-free",
  "status": "likely",
  "confidence": 0.82,
  "evidenceIds": ["ev_123", "ev_456"],
  "reason": "The official menu contains vegan dishes and explicitly mentions dairy-free substitutions."
}
```

Application code must verify every cited evidence ID.

## 31. Deterministic Rules Before LLM Analysis

Prefer deterministic mappings when evidence is explicit.

Examples:

```text
Structured provider:
servesVegetarianFood = true

Requirement:
vegetarian

→ structured supporting evidence
```

```text
Official menu:
dish explicitly marked "DF"

Requirement:
dairy-free

→ strong supporting evidence
```

Use the LLM mainly for ambiguous natural-language evidence.

## 32. API

Suggested endpoint:

```http
POST /api/restaurants/:restaurantId/dietary-analysis
```

Request:

```json
{
  "requirements": ["dairy-free", "gluten-free"],
  "evidenceRequirement": "normal"
}
```

Response:

```json
{
  "assessments": [
    {
      "requirement": "dairy-free",
      "status": "confirmed",
      "confidence": 0.95,
      "evidence": []
    },
    {
      "requirement": "gluten-free",
      "status": "uncertain",
      "confidence": 0.35,
      "evidence": []
    }
  ]
}
```

Event-facing APIs must continue enforcing membership and privacy rules.

## 33. Observability

Track:

```text
dietary_analysis_requests
dietary_analysis_cache_hits
dietary_analysis_cache_misses
dietary_evidence_sources_checked
dietary_analysis_confirmed
dietary_analysis_likely
dietary_analysis_uncertain
dietary_analysis_unsupported
dietary_analysis_conflicting
dietary_analysis_latency
dietary_analysis_failures
```

Do not log private participant explanations or unnecessary participant/dietary associations.

## 34. Testing

### Unit Tests

Test:

- evidence normalization
- evidence reliability ordering
- structured-provider mappings
- missing evidence → uncertain
- contradictory evidence → conflicting
- strict evidence thresholds
- normal evidence thresholds
- cache expiration
- privacy sanitization

### Analyzer Fixtures

Cover:

```text
Official menu explicitly says dairy-free
Vegan items but no dairy-free statement
Several recent reviews mention dairy-free
One old review mentions dairy-free
No dietary information
Official menu contradicts a review
Gluten-free menu with cross-contact warning
Chain-wide allergen page only
Location-specific allergen page
```

### Privacy Tests

Verify that:

```text
"I have a severe dairy allergy."
```

can become:

```json
{
  "requirement": "dairy-free",
  "strength": "required",
  "evidenceRequirement": "strict"
}
```

without the original explanation appearing in Negotiator messages, restaurant searches, evidence searches, other-participant APIs, logs, or final explanations.

## 35. Mock Dietary Analyzer

Provide:

```ts
export class MockDietaryAnalyzer implements DietaryAnalyzer {
  // deterministic fixture-based implementation
}
```

Normal CI must not require Google, live restaurant websites, external search, or an LLM API.

## 36. Implementation Phases

### Phase 1 — Domain Model

Implement:

- `DietaryConstraint`
- `DietaryAssessment`
- `DietaryEvidence`
- assessment statuses
- reliability model
- evidence strictness

### Phase 2 — Structured Evidence

Map dietary information already supplied by restaurant providers and add deterministic assessment rules.

### Phase 3 — Official Restaurant Evidence

Implement targeted discovery/retrieval for:

- official website
- menu
- allergen information
- dietary FAQ
- evidence extraction and source tracking

### Phase 4 — Dietary Analyzer

Implement evidence-based reasoning with structured output and mandatory evidence references.

### Phase 5 — Council Integration

Integrate assessments into:

- candidate filtering
- candidate scoring
- Negotiator decisions
- search broadening
- finalist selection

### Phase 6 — UI

Add:

- dietary compatibility indicators
- Confirmed/Likely/Uncertain states
- evidence/source inspection
- privacy-safe Council explanations

### Phase 7 — Review Evidence

Add reviews as lower-priority supporting evidence when authoritative sources are insufficient.

## 37. Acceptance Criteria

The feature is complete when:

1. Restaurant Council supports dietary requirements beyond Google Places' structured fields.
2. Dairy-free can be required or preferred.
3. A user can request stricter evidence without revealing why.
4. Every assessment has an explicit status.
5. Positive/negative conclusions are tied to evidence.
6. Missing information results in `uncertain`, not `unsupported`.
7. Conflicting evidence is represented explicitly.
8. Official restaurant information is prioritized over reviews.
9. Dish names alone are not treated as proof of dairy-free status.
10. Vegan labeling can support dairy-free availability without being treated as proof of strict cross-contact safety.
11. Strict requirements require stronger evidence.
12. The UI never represents an AI assessment as a medical-safety guarantee.
13. Deep analysis is limited to plausible candidates.
14. Assessments can be cached independently of participant-private explanations.
15. The Negotiator receives sanitized constraints, not private motivations.
16. Other participants cannot determine who supplied a private dietary requirement.
17. External providers receive no unnecessary participant identity or medical information.
18. Final recommendations can explain dietary compatibility and link to supporting sources.
19. The system remains functional when no evidence can be found.
20. Normal CI requires no external APIs or live websites.
21. The architecture supports additional dietary requirements and evidence providers later.

## 38. Desired End State

A participant privately tells their Personal Agent:

```text
"I need dairy-free food and I want you to be very strict about it,
but don't tell the group why."
```

The Personal Agent produces:

```json
{
  "requirement": "dairy-free",
  "strength": "required",
  "evidenceRequirement": "strict"
}
```

The Negotiator searches without receiving the participant's private explanation.

For Restaurant A:

```text
Official menu:
Several dishes explicitly marked vegan.

Official allergen page:
Milk allergens identified by dish.

Result:
CONFIRMED — strong evidence of dairy-free menu options
```

For Restaurant B:

```text
Two reviews mention dairy-free substitutions.
No official dietary information found.

Result:
UNCERTAIN for strict accommodation
```

For Restaurant C:

```text
Official allergen information indicates
the potentially suitable dishes contain milk.

Result:
UNSUPPORTED
```

Restaurant C can be eliminated. Restaurant B can trigger deeper investigation. Restaurant A can advance.

The group sees:

```text
Dietary requirements: ✓ Confirmed
```

and can inspect supporting restaurant sources.

They do not see who requested the restriction, why it was requested, or whether it relates to a medical condition.

This allows Restaurant Council to investigate real restaurants for requirements that Google Places cannot directly express while preserving the project's core private multi-agent architecture.
