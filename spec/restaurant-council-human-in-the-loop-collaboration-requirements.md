# Restaurant Council — Human-in-the-Loop Council Collaboration Requirements

## 1. Overview

Add a human-in-the-loop collaboration layer to Restaurant Council.

The AI Council should explicitly escalate uncertainty when it cannot confidently determine whether an otherwise-promising restaurant satisfies an important requirement. Event participants can investigate the uncertainty, contribute evidence, discuss candidates in an event chat, and express restaurant-level decisions such as preference, dislike, or outright rejection.

Human input must feed back into the Council so recommendations can be re-evaluated automatically.

This feature consists of three integrated capabilities:

1. **Human verification and evidence**
2. **Event chat**
3. **Participant restaurant decisions, including rejection**

These capabilities should turn Restaurant Council from a system that merely recommends restaurants into a collaborative human + multi-agent decision system.

---

## 2. Goals

- Explicitly surface unresolved restaurant requirements.
- Allow participants to claim verification tasks such as calling a restaurant.
- Allow participants to record what they learned.
- Treat human verification as structured, time-stamped evidence.
- Automatically re-evaluate restaurant candidates after relevant human evidence is added.
- Add event-scoped participant chat.
- Allow AI/system activity to appear in the event conversation.
- Allow users to prefer, dislike, approve, or reject restaurant candidates.
- Allow rejection reasons to be public or private.
- Prevent private reasons from leaking to other participants.
- Feed human decisions back into the Negotiator.
- Support natural-language preference discovery from chat, but require confirmation before mutating structured preferences.
- Maintain an auditable history of Council actions.
- Preserve the existing private Personal Agent architecture.

---

## 3. Core Principle

The AI is not required to resolve every uncertainty.

When Restaurant Council has insufficient evidence, it should say so and involve the humans.

Example:

```text
Dairy-free accommodation: UNCERTAIN

✓ Vegan dishes found
? No allergen information found
? Cross-contact information unavailable

This restaurant otherwise looks like a strong match.

[Verify this]    [Not suitable]
```

The desired loop is:

```text
Personal Agents
      |
      v
Negotiator
      |
      v
Restaurant Candidates
      |
      +---- Confirmed fit ------------------+
      |                                     |
      +---- Clearly incompatible → Reject   |
      |                                     |
      +---- Uncertain                       |
             |                              |
             v                              |
       Human Verification                   |
             |                              |
             v                              |
       Human Evidence                       |
             |                              |
             v                              |
       Assessment Updated                   |
             |                              |
             +------------------------------+
                            |
                            v
                   Council Re-evaluates
```

---

## 4. Human Verification

When an otherwise viable candidate has an unresolved important requirement, Restaurant Council should be able to create or suggest a verification task.

Examples:

```text
Can this restaurant accommodate dairy-free meals?
```

```text
Can they seat a party of 8?
```

```text
Do they have high chairs?
```

```text
Can they accommodate a wheelchair?
```

```text
Do they accept reservations at 7:30 PM?
```

Initial implementation should focus on restaurant capability/requirement verification, especially dietary uncertainty.

---

## 5. Verification Task Model

```ts
export interface VerificationTask {
  id: string;
  eventId: string;
  restaurantId: string;

  requirementType: string;
  requirementValue?: unknown;

  question: string;

  status:
    | "open"
    | "claimed"
    | "completed"
    | "cancelled";

  createdBy:
    | { type: "system" }
    | { type: "user"; userId: string };

  assignedToUserId?: string;

  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
}
```

Example:

```json
{
  "restaurantId": "res_123",
  "requirementType": "dietary",
  "requirementValue": "dairy-free",
  "question": "Can this restaurant accommodate dairy-free meals?",
  "status": "open"
}
```

---

## 6. Verification UI

Example candidate state:

```text
Cooper's Hawk Winery & Restaurant

★ 4.6 (2,184)

Strong Council match

Dietary compatibility
⚠ Dairy-free accommodation is uncertain

We found vegan dishes, but could not verify
dairy-free preparation or accommodation.

Suggested question:
"Do you have dairy-free meal options, and can
they be prepared without dairy?"

[I'll verify]    [Not suitable]
```

When a participant clicks `I'll verify`:

```text
Gee is verifying dairy-free accommodation.
```

The task becomes claimed.

---

## 7. Verification Methods

Support:

```ts
export type VerificationMethod =
  | "phone"
  | "in-person"
  | "email"
  | "website"
  | "other";
```

Initial UI should prominently support `phone`.

Restaurant Council may show useful restaurant contact information when already available from the restaurant provider.

The application does not need to place phone calls itself in the initial implementation.

---

## 8. Completing Verification

After investigation:

```text
What did you find out?

○ They can accommodate it
○ They cannot accommodate it
○ Still unclear

How did you verify it?

○ Phone
○ In person
○ Email
○ Website
○ Other

Notes (optional)

"They said several entrees can be prepared
without butter or dairy."

[Save Result]
```

---

## 9. Human Evidence Model

Human verification becomes structured evidence.

```ts
export interface HumanEvidence {
  id: string;
  eventId: string;
  restaurantId: string;

  requirementType: string;
  requirementValue?: unknown;

  providedByUserId: string;

  method: VerificationMethod;

  result:
    | "supports"
    | "contradicts"
    | "uncertain";

  notes?: string;

  verifiedAt: string;

  visibility: "event" | "private";
}
```

Human evidence should be location-specific unless explicitly known otherwise.

---

## 10. Dietary Integration

Human evidence must integrate with the existing Dietary Requirements & Evidence-Based Analysis feature.

Add a human evidence source type:

```ts
sourceType:
  | "structured-provider"
  | "official-allergen-info"
  | "official-menu"
  | "official-website"
  | "restaurant-statement"
  | "menu-provider"
  | "review"
  | "human-verification"
  | "other";
```

Example:

```text
Dairy-free: CONFIRMED BY PARTICIPANT

Gee called the restaurant today.

Restaurant response:
Several entrees can be prepared without dairy.
```

Do not present this as a medical safety guarantee.

Prefer:

```text
A participant called the restaurant and was told
that dairy-free preparation is available.
```

Never:

```text
This restaurant is safe for dairy allergies.
```

---

## 11. Human Evidence Reliability

Human verification is valuable but should remain distinguishable from published official documentation.

Suggested conceptual hierarchy:

```text
Official allergen documentation
Official menu / restaurant statement
Direct participant verification with restaurant
Structured provider information
Trusted menu data
Review evidence
Other evidence
```

The exact ordering may vary by requirement.

A recent direct phone confirmation may be especially useful for location-specific questions.

Always retain the evidence source rather than flattening everything into a boolean.

---

## 12. Evidence Freshness

Human verification must be time-stamped.

```ts
verifiedAt: string;
```

Restaurant policies, menus, staffing, and accommodations change.

Do not treat human verification as permanent global truth.

Initial behavior:

- Evidence applies to the current event.
- It may optionally contribute to a reusable restaurant evidence cache.
- Reusable evidence must have an expiration policy.
- Strict dietary requirements may require re-verification after an appropriate period.

---

## 13. Verification Task Assignment

Any eligible event participant may claim an open task.

Flow:

```text
OPEN
  |
  | participant clicks "I'll verify"
  v
CLAIMED
  |
  | result submitted
  v
COMPLETED
```

Prevent accidental duplicate work where practical.

Allow:

```text
[Release task]
```

so another participant can take over.

The host may also assign a task to a participant if application permissions allow it.

---

## 14. Suggested Questions

Restaurant Council may generate a concise question for the participant to ask.

Example:

```text
Do you have dairy-free meal options, and can
they be prepared without dairy?
```

For stricter dietary requirements:

```text
Do you have dishes prepared without dairy, and
can you tell me whether your kitchen can accommodate
a strict dairy restriction?
```

Suggested questions must not reveal participant identities or private medical explanations.

---

## 15. Event Chat

Every event should have an event-scoped chat.

Example:

```text
Dinner Saturday
────────────────────────────────────────

Restaurant Council
I've narrowed the search to 6 restaurants.

Sarah
I like Cooper's Hawk.

Mike
That works for me.

Restaurant Council
⚠ Dairy-free accommodation at Cooper's Hawk
is currently uncertain.

Gee
I'll call them.

Restaurant Council
📞 Gee is verifying dairy-free accommodation.

Gee
They said they have several dairy-free entrees.

Restaurant Council
✓ Dairy-free accommodation updated based on
Gee's verification.

Jessica
Great.
```

---

## 16. Chat Message Model

```ts
export interface EventChatMessage {
  id: string;
  eventId: string;

  sender:
    | { type: "user"; userId: string }
    | { type: "council" }
    | { type: "system" };

  messageType:
    | "text"
    | "council-update"
    | "verification-update"
    | "restaurant-decision"
    | "preference-confirmation";

  text?: string;

  relatedRestaurantId?: string;
  relatedActionId?: string;

  createdAt: string;
  editedAt?: string;
}
```

AI/system messages must be visually distinct from participant messages.

---

## 17. Chat Permissions

Only authorized event participants may read or post in the event chat.

Requirements:

- authentication
- event membership validation
- authorization on every read/write operation
- server-side enforcement
- no reliance on frontend-only checks

Users removed from an event should lose access according to the existing event membership rules.

---

## 18. Chat Delivery

The Cloudflare deployment should support near-real-time event chat.

Use an architecture appropriate for the existing Cloudflare stack.

Conceptually:

```text
React Clients
     |
     v
Cloudflare Backend
     |
     +---- persistent chat storage
     |
     +---- real-time event delivery
```

The implementation should isolate transport concerns from chat domain logic so WebSocket/Durable Object/provider choices can evolve.

---

## 19. Chat and AI

Restaurant Council may participate in the chat.

Council messages should include:

- candidate updates
- verification requests
- verification status changes
- candidate elimination
- recommendation changes
- unresolved constraints
- preference confirmation prompts

Avoid excessive AI chatter.

The Council should post when information materially changes the group's decision process.

---

## 20. Preference Detection from Chat

Chat may contain preference statements:

```text
I'd really rather have Italian.
```

```text
Actually I can't do anything over $40.
```

```text
I don't care about outdoor seating anymore.
```

A Personal Agent may detect a possible structured preference.

Do not silently mutate participant preferences.

Instead request confirmation.

Example:

```text
Restaurant Council

You mentioned you'd prefer Italian.

Use this as a preference for this event?

[Yes]    [No]
```

For:

```text
Actually I can't do anything over $40.
```

ask:

```text
Make $40/person a required price limit
for your preferences in this event?

[Yes]    [No]
```

---

## 21. Private Preference Confirmation

Preference extraction should occur within the appropriate Personal Agent privacy boundary.

If the resulting preference is private, the structured constraint should flow to the Negotiator using the existing sanitized constraint mechanism.

The public event chat must not expose private Personal Agent reasoning.

---

## 22. Restaurant Decisions

Participants should be able to express restaurant-level decisions.

```ts
export type RestaurantDecisionType =
  | "approve"
  | "prefer"
  | "neutral"
  | "dislike"
  | "reject";
```

Semantics:

```text
approve
→ restaurant is acceptable to this participant

prefer
→ positive ranking signal

neutral
→ no meaningful preference

dislike
→ negative ranking signal, but not elimination

reject
→ participant considers restaurant unacceptable
```

---

## 23. Restaurant Rejection

A participant may explicitly reject a candidate.

Example UI:

```text
Reject this restaurant?

Why? (optional)

○ Dietary concern
○ Too expensive
○ Too far away
○ Don't like the cuisine
○ Been there before
○ Bad previous experience
○ Accessibility concern
○ Other

Additional note (optional)

________________________________

Share reason with:

● Everyone
○ My agent only

[Cancel]    [Reject Restaurant]
```

---

## 24. Rejection Semantics

An explicit rejection should normally make the restaurant incompatible with the event because Restaurant Council's objective is to find a restaurant acceptable to all participants.

However, preserve the distinction between:

```text
dislike
```

and:

```text
reject
```

A dislike changes ranking.

A rejection is a veto/hard incompatibility unless future event settings explicitly define different voting rules.

---

## 25. Rejection Reason Visibility

Support:

```ts
export type DecisionVisibility =
  | "event"
  | "private";
```

Public example:

```text
Mike rejected Anthony's Coal Fired Pizza.
Reason: Too far away.
```

Private example:

```text
This restaurant doesn't work for everyone.
```

The Negotiator may receive the minimum structured reason required for decision-making.

Other participants must not receive private notes.

---

## 26. Private Rejection

Example private input:

```text
I went there before and hated it.
```

Possible structured result:

```json
{
  "decision": "reject",
  "visibility": "private",
  "reasonCategory": "previous-experience"
}
```

Public representation:

```text
This restaurant doesn't work for everyone.
```

Do not expose the private explanation.

---

## 27. Decision Model

```ts
export interface RestaurantDecision {
  id: string;
  eventId: string;
  restaurantId: string;
  userId: string;

  decision: RestaurantDecisionType;

  reasonCategory?: string;
  note?: string;

  visibility: DecisionVisibility;

  createdAt: string;
  updatedAt?: string;
}
```

A participant should have one current effective decision per restaurant, while changes remain auditable through Council actions/events.

---

## 28. Changing a Decision

Participants may change their mind.

Example:

```text
Rejected → Neutral
Dislike → Prefer
Prefer → Reject
```

Update the effective decision and record an action/history entry.

Changing a rejection should trigger Council re-evaluation.

---

## 29. Council Actions

Introduce a generalized event action model.

```ts
export interface CouncilAction {
  id: string;
  eventId: string;
  restaurantId?: string;
  actorUserId?: string;

  type:
    | "verification-requested"
    | "verification-claimed"
    | "verification-released"
    | "verification-completed"
    | "restaurant-approved"
    | "restaurant-preferred"
    | "restaurant-disliked"
    | "restaurant-rejected"
    | "restaurant-decision-changed"
    | "preference-confirmed"
    | "preference-declined"
    | "candidate-reconsidered";

  visibility:
    | "event"
    | "private";

  payload: unknown;

  createdAt: string;
}
```

Use typed payload schemas per action type rather than accepting arbitrary unvalidated data.

---

## 30. Event Timeline

Council actions may drive a unified event activity timeline.

Example:

```text
12:05 PM  Council narrowed candidates to 6.

12:07 PM  Gee started verifying dairy-free
          accommodation at Cooper's Hawk.

12:14 PM  Gee completed verification.

12:14 PM  Council re-evaluated Cooper's Hawk.

12:16 PM  Mike rejected Restaurant B.

12:16 PM  Council updated the candidate list.
```

Chat and actions may be displayed together while remaining separate domain concepts internally.

---

## 31. Event-Driven Re-Evaluation

Relevant human actions should automatically trigger re-evaluation.

```text
HumanVerificationCompleted
          |
          v
Evidence Updated
          |
          v
Requirement Assessment Updated
          |
          v
Negotiator Re-evaluates
          |
          v
Candidate State/Ranking Updated
          |
          v
Council Chat Update
```

Likewise:

```text
RestaurantRejected
        |
        v
Participant Decision Updated
        |
        v
Candidate Compatibility Updated
        |
        v
Negotiator Re-evaluates
        |
        v
Council Chat Update
```

Users should not normally need to click "Run Council Again."

---

## 32. Re-Evaluation Debouncing

Multiple actions may occur close together.

Avoid unnecessarily rerunning expensive AI evaluation after every keystroke/chat message.

Only structured decision/evidence/preference changes should trigger re-evaluation.

Consider debouncing/coalescing related events when appropriate.

Plain chat messages should not automatically trigger full Council evaluation unless they produce a confirmed structured preference/action.

---

## 33. Candidate State

Extend event restaurant candidate state as needed.

Example:

```ts
export type CandidateStatus =
  | "active"
  | "needs-verification"
  | "rejected"
  | "eliminated"
  | "finalist"
  | "selected";
```

Potential metadata:

```ts
export interface CandidateCouncilState {
  restaurantId: string;

  status: CandidateStatus;

  unresolvedRequirements: string[];

  participantDecisions: RestaurantDecision[];

  verificationTasks: VerificationTask[];
}
```

---

## 34. Uncertainty Escalation

The Council should create/suggest human verification only when:

- the requirement materially affects compatibility;
- the restaurant otherwise remains a plausible candidate;
- automated evidence is insufficient;
- further automated research is unlikely to resolve it cheaply/reliably.

Do not ask humans to verify restaurants already eliminated for unrelated hard constraints.

---

## 35. Verification Prioritization

If several candidates need verification, prioritize high-value tasks.

Example:

```text
Restaurant A
Overall match: strong
Dairy-free: uncertain

Restaurant B
Overall match: weak
Dairy-free: uncertain
Distance: poor
Cuisine: poor
```

Restaurant A should be surfaced for verification first.

The system should avoid generating busywork.

---

## 36. AI Suggested Human Actions

The Negotiator may recommend:

```text
This restaurant is one of the strongest matches,
but dairy-free accommodation is uncertain.

A quick call could resolve the remaining question.
```

AI suggestions must remain suggestions.

The system must not claim a participant contacted a restaurant until that participant records the result.

---

## 37. Manual Override vs Evidence

Avoid a generic unrestricted "mark dairy-free = true" database flag.

Instead, manual confirmation should create evidence:

```text
HumanEvidence
```

which the Dietary Analyzer/requirement evaluator consumes.

This preserves:

- who reported it
- how it was verified
- when it was verified
- what was actually said
- whether it supports or contradicts the requirement

The resulting assessment may become `confirmed`, but the source remains visible.

---

## 38. Human Evidence Editing

Participants should be able to correct their own verification result.

Corrections should:

- update effective evidence;
- retain an audit trail;
- trigger re-evaluation;
- generate an appropriate event activity update when publicly visible.

Hosts/admins may have additional moderation rights according to existing event permissions.

---

## 39. Chat Restaurant References

Allow messages to reference restaurant candidates.

Examples:

```text
Sarah:
I like [Cooper's Hawk].
```

```text
Mike:
Parking at [Restaurant B] is usually difficult.
```

Store restaurant references structurally when created through UI interactions.

This allows future AI tools to understand which restaurant a message refers to without relying only on text matching.

---

## 40. Restaurant Discussion UI

Each restaurant detail/candidate view may provide:

```text
[Discuss]
[Prefer]
[Dislike]
[Reject]
```

`Discuss` can open/focus the event chat with the restaurant attached as context.

Example composer:

```text
Discussing: Cooper's Hawk

[ message...                         ]

[Send]
```

---

## 41. Notifications

Initial notification needs:

- verification task assigned/claimed where relevant;
- verification completed;
- participant rejected a restaurant if public;
- Council recommendation materially changed;
- direct chat activity according to future notification preferences.

Avoid excessive notifications for every minor ranking adjustment.

---

## 42. Persistence

Suggested entities/tables:

```text
event_chat_messages
verification_tasks
human_evidence
restaurant_decisions
council_actions
```

Relationships:

```text
Event
 ├── ChatMessages
 ├── CouncilActions
 ├── RestaurantCandidates
 │      ├── RestaurantDecisions
 │      ├── VerificationTasks
 │      └── HumanEvidence
 └── Participants
```

Reuse existing dietary evidence tables where practical instead of duplicating equivalent evidence storage.

---

## 43. API Endpoints

Possible endpoints:

```http
GET  /api/events/:eventId/chat
POST /api/events/:eventId/chat

GET  /api/events/:eventId/actions

POST /api/events/:eventId/restaurants/:restaurantId/decisions
PUT  /api/events/:eventId/restaurants/:restaurantId/decisions/me

POST /api/events/:eventId/restaurants/:restaurantId/verifications
POST /api/events/:eventId/verifications/:verificationId/claim
POST /api/events/:eventId/verifications/:verificationId/release
POST /api/events/:eventId/verifications/:verificationId/complete
```

Exact route structure may follow existing project conventions.

All endpoints require server-side authentication and event authorization.

---

## 44. Real-Time Updates

When one participant acts, other connected event participants should see relevant public updates without manually refreshing.

Examples:

- new chat message;
- verification claimed;
- verification completed;
- restaurant rejected;
- candidate status changed;
- recommendation updated.

The implementation may use Cloudflare-compatible real-time infrastructure such as Durable Objects/WebSockets if appropriate to the existing architecture.

Keep the domain event model independent of the transport mechanism.

---

## 45. Privacy Boundaries

Restaurant Council has three relevant information scopes:

```text
PRIVATE TO PERSONAL AGENT
- private preference explanations
- private rejection notes
- sensitive motivations

EVENT-SHARED
- public chat
- public verification results
- public rejection reasons
- Council activity

NEGOTIATOR-SANITIZED
- minimum constraints needed for group decision
- compatibility state
- private veto without private explanation
```

Enforce these boundaries in backend data access, agent context construction, and logs.

---

## 46. AI Context Construction

Do not simply provide the entire raw event chat to every agent.

Construct context based on authorization and role.

Personal Agent:

```text
public event context
+ that user's private information
```

Negotiator:

```text
public event context
+ sanitized constraints
+ candidate decisions
+ permitted evidence
```

Other Personal Agents:

```text
public event context
+ their own user's private information
```

Private rejection reasons must not leak through AI context.

---

## 47. Security

- Validate event membership for every chat/action request.
- Validate restaurant belongs to the event candidate set where required.
- Validate verification task ownership/permissions.
- Validate typed Council action payloads.
- Sanitize/render chat safely.
- Treat chat text as untrusted input.
- Prevent prompt injection in chat from overriding agent authorization/tool rules.
- Rate-limit chat and action endpoints.
- Do not expose private notes in public APIs.
- Do not trust client-supplied actor IDs.
- Derive actor identity from authentication.
- Preserve auditability for sensitive state changes.

---

## 48. Moderation / Deletion

At minimum:

- users may edit/delete their ordinary chat messages according to product policy;
- structured actions should not simply disappear when chat text is deleted;
- audit history should preserve important decision/evidence changes;
- private information must remain private in historical views.

Do not make chat messages the sole source of truth for restaurant decisions or verification evidence.

---

## 49. Observability

Track:

```text
event_chat_messages_sent
verification_tasks_created
verification_tasks_claimed
verification_tasks_completed
verification_tasks_released
human_evidence_added
restaurant_preferred
restaurant_disliked
restaurant_rejected
restaurant_decision_changed
council_reevaluations_triggered
council_reevaluation_latency
preference_confirmation_prompted
preference_confirmation_accepted
preference_confirmation_declined
```

Do not log raw private notes, sensitive explanations, or unnecessary chat content.

---

## 50. Testing

### Verification Tests

Test:

- create verification task;
- claim task;
- prevent invalid claim;
- release task;
- complete with supports;
- complete with contradicts;
- complete with uncertain;
- human evidence created;
- evidence timestamped;
- assessment re-evaluated;
- candidate updated.

### Restaurant Decision Tests

Test:

- prefer;
- dislike;
- reject;
- public reason;
- private reason;
- change decision;
- remove rejection;
- candidate re-evaluation;
- private reason absent from public API.

### Chat Tests

Test:

- authorized participant posts;
- non-member denied;
- public Council update;
- restaurant reference;
- real-time delivery;
- safe rendering;
- deleted message does not delete structured decision.

### Privacy Tests

Verify private rejection:

```text
"I went there before and hated it."
```

does not appear in:

- public chat;
- other participant APIs;
- other Personal Agent context;
- public Council activity;
- normal logs.

Verify the Negotiator receives only the minimum effective veto/constraint.

### Preference Detection Tests

Input:

```text
I'd really rather have Italian.
```

Verify:

- possible preference detected;
- preference is not immediately persisted;
- user receives confirmation;
- accepting creates structured preference;
- declining does not.

### Event Re-Evaluation Tests

Verify:

```text
Human evidence added
→ assessment updated
→ Negotiator triggered
→ candidate state updated
```

and:

```text
Restaurant rejected
→ candidate compatibility updated
→ Negotiator triggered
→ recommendation updated
```

---

## 51. Mock / Local Development

Provide deterministic fixtures for:

- verification tasks;
- human evidence;
- restaurant decisions;
- event chat;
- Council actions;
- re-evaluation events.

Normal CI must not require live restaurant calls, live LLM calls, or external messaging infrastructure.

---

## 52. Implementation Phases

### Phase 1 — Council Action Domain

Implement:

- `CouncilAction`
- typed action payloads
- persistence
- visibility rules
- event domain events

### Phase 2 — Restaurant Decisions

Implement:

- approve/prefer/dislike/reject
- reason categories
- public/private visibility
- candidate compatibility updates
- re-evaluation triggers

### Phase 3 — Verification Tasks

Implement:

- open/claim/release/complete
- suggested questions
- verification UI
- human evidence creation

### Phase 4 — Dietary/Evidence Integration

Connect `human-verification` evidence to the existing Dietary Analyzer and trigger updated assessments.

### Phase 5 — Event Chat

Implement:

- event chat persistence
- participant messages
- Council/system messages
- restaurant references
- authorization

### Phase 6 — Real-Time Delivery

Add Cloudflare-compatible real-time updates for chat, actions, and candidate changes.

### Phase 7 — Automatic Council Re-Evaluation

Wire structured human actions into the Negotiator/candidate evaluation pipeline.

### Phase 8 — Preference Detection

Allow Personal Agents to detect potential preferences in chat and request explicit confirmation before applying them.

### Phase 9 — Notifications and Polish

Add task/recommendation notifications, event timeline presentation, and collaboration UX polish.

---

## 53. Acceptance Criteria

The initial feature is complete when:

1. Restaurant Council can identify a promising candidate with an unresolved requirement and request human verification.
2. A participant can claim a verification task.
3. A participant can record supports/contradicts/uncertain results.
4. Verification records who supplied the evidence, how, and when.
5. Human verification integrates with dietary/requirement assessment.
6. Human evidence does not become an unexplained permanent boolean.
7. Completing verification automatically triggers relevant Council re-evaluation.
8. Every event has participant chat.
9. Authorized participants can send and receive chat messages.
10. Council/system updates are visually distinct.
11. Participants can prefer, dislike, approve, and reject restaurants.
12. Dislike affects ranking without acting as a veto.
13. Reject normally makes the restaurant incompatible with the event.
14. Users can supply an optional rejection reason.
15. Rejection reasons can be event-visible or private.
16. Private rejection explanations never appear to other participants.
17. A participant can change a restaurant decision.
18. Decision changes trigger re-evaluation when relevant.
19. Chat can structurally reference restaurant candidates.
20. Chat preference detection requires explicit confirmation before changing structured preferences.
21. Plain chat messages do not trigger expensive full re-evaluation unless converted into a confirmed structured action.
22. Public human actions can appear in the event timeline/chat.
23. Relevant public changes propagate to connected participants in near real time.
24. Agent context respects Personal Agent, Negotiator, and event visibility boundaries.
25. Chat content cannot bypass authorization or agent tool rules.
26. Normal CI works without live LLM/provider/restaurant calls.
27. Important structured actions remain auditable independently of chat history.

---

## 54. Desired End State

Restaurant Council has narrowed an event to several strong candidates.

One candidate shows:

```text
Cooper's Hawk Winery & Restaurant

Council match: Strong

✓ Distance
✓ Price
✓ Kid-friendly
⚠ Dairy-free accommodation uncertain

We found vegan dishes but could not verify
dairy-free preparation.

[I'll verify]   [Discuss]   [Reject]
```

Gee clicks:

```text
I'll verify
```

The event chat shows:

```text
Restaurant Council
📞 Gee is verifying dairy-free accommodation
at Cooper's Hawk.
```

Gee calls and submits:

```text
They can accommodate it
Method: Phone

"They said several entrees can be prepared
without butter or dairy."
```

Restaurant Council records time-stamped human evidence, re-runs the relevant dietary assessment, and then re-evaluates the candidate.

Chat updates:

```text
Restaurant Council
✓ Dairy-free accommodation at Cooper's Hawk
was verified by Gee via phone today.

I've updated the Council evaluation.
Cooper's Hawk is now one of the strongest matches.
```

Meanwhile Mike rejects another candidate privately because of a previous bad experience.

Other participants see:

```text
Restaurant Council
That restaurant doesn't work for everyone,
so I've removed it from the finalists.
```

They do not see Mike's private reason.

Later Sarah writes:

```text
I'd really prefer Italian if we can find something.
```

Sarah's Personal Agent asks:

```text
Use Italian as a preferred cuisine for this event?

[Yes] [No]
```

Sarah selects Yes. The structured preference is added, the Negotiator re-evaluates the remaining candidates, and the recommendations update.

The result is a collaborative Council in which AI agents discover, analyze, and negotiate; humans resolve real-world uncertainty and exercise vetoes/preferences; and both forms of intelligence feed into the same privacy-preserving decision process.
