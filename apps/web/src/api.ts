export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  } & T;
  if (!response.ok) {
    throw new ApiError(
      data.error?.code ?? "ERROR",
      data.error?.message ?? "Request failed",
      response.status
    );
  }
  return data;
}

export const api = {
  health: () =>
    request<{
      ok: boolean;
      service: string;
      agents: "llm" | "deterministic";
      restaurants?: "google" | "mock";
      dietary?: "mock" | "live";
    }>("/api/health"),
  me: () => request<{ user: User }>("/api/auth/me"),
  signin: (email: string, displayName: string) =>
    request<{ user: User }>("/api/auth/dev-signin", {
      method: "POST",
      body: JSON.stringify({ email, displayName })
    }),
  signout: () => request("/api/auth/signout", { method: "POST" }),
  events: () => request<{ events: EventSummary[] }>("/api/events"),
  createEvent: (input: {
    name: string;
    date?: string;
    locationLabel?: string;
    searchArea?: EventSearchArea;
    radiusMiles?: number;
  }) =>
    request<{ event: EventSummary }>("/api/events", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  event: (id: string) =>
    request<{ event: EventSummary; members: Member[] }>(`/api/events/${id}`),
  updateEvent: (id: string, input: Record<string, unknown>) =>
    request<{ event: EventSummary }>(`/api/events/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  invite: (eventId: string, email: string) =>
    request<{ invitation: Invitation; devInviteUrl?: string }>(
      `/api/events/${eventId}/invitations`,
      { method: "POST", body: JSON.stringify({ email }) }
    ),
  invitations: (eventId: string) =>
    request<{ invitations: Invitation[] }>(`/api/events/${eventId}/invitations`),
  preferences: (eventId: string) =>
    request<{ preferences: Preference[] }>(`/api/events/${eventId}/preferences`),
  addPreference: (eventId: string, input: Record<string, unknown>) =>
    request<{ preference: Preference }>(`/api/events/${eventId}/preferences`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updatePreference: (eventId: string, preferenceId: string, input: Record<string, unknown>) =>
    request<{ preference: Preference }>(`/api/events/${eventId}/preferences/${preferenceId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deletePreference: (eventId: string, preferenceId: string) =>
    request<{ ok: boolean }>(`/api/events/${eventId}/preferences/${preferenceId}`, {
      method: "DELETE"
    }),
  previewInvite: (token: string) =>
    request<{
      event: { name?: string; date?: string; locationLabel?: string };
      inviterName: string;
    }>(`/api/invites/${token}`),
  acceptInvite: (token: string) =>
    request<{ eventId: string }>(`/api/invites/${token}/accept`, { method: "POST" }),
  startCouncil: (eventId: string) =>
    request<{ snapshot: CouncilSnapshot }>(`/api/events/${eventId}/council/start`, {
      method: "POST"
    }),
  council: (eventId: string) =>
    request<{ snapshot: CouncilSnapshot | null }>(`/api/events/${eventId}/council`),
  audit: (eventId: string) =>
    request<{ events: AuditRow[] }>(`/api/events/${eventId}/audit`),
  authorizationDemo: (eventId: string) =>
    request<{ results: AuthzDemo[] }>(`/api/events/${eventId}/authorization-demo`),
  suggestLocations: (query: string) =>
    request<{ suggestions: Array<{ displayName: string; placeId?: string }> }>(
      "/api/locations/suggest",
      { method: "POST", body: JSON.stringify({ query }) }
    ),
  resolveLocation: (query: string, radiusMiles: number, placeId?: string) =>
    request<{
      location: { displayName: string; latitude: number; longitude: number };
      searchArea: EventSearchArea;
    }>("/api/locations/resolve", {
      method: "POST",
      body: JSON.stringify({ query, radiusMiles, placeId })
    }),
  interpretEvent: (text: string, timezone: string) =>
    request<{ result: EventCreationResult; parserVersion: string }>("/api/events/interpret", {
      method: "POST",
      body: JSON.stringify({ text, timezone })
    }),
  modifyEventIntent: (intent: EventCreationIntent, text: string, timezone: string) =>
    request<{ result: EventCreationResult; parserVersion: string }>("/api/events/interpret/modify", {
      method: "POST",
      body: JSON.stringify({ intent, text, timezone })
    }),
  createEventFromIntent: (intent: EventCreationIntent, timezone: string) =>
    request<{ event: EventSummary }>("/api/events/from-intent", {
      method: "POST",
      body: JSON.stringify({ intent, timezone })
    }),
  collaboration: (eventId: string) =>
    request<CollaborationState>(`/api/events/${eventId}/collaboration`),
  postChat: (eventId: string, text: string, relatedRestaurantId?: string) =>
    request<{ message: ChatMessage; prompt?: PreferencePrompt }>(`/api/events/${eventId}/chat`, {
      method: "POST",
      body: JSON.stringify({ text, relatedRestaurantId })
    }),
  deleteChat: (eventId: string, messageId: string) =>
    request<{ message: ChatMessage }>(`/api/events/${eventId}/chat/${messageId}`, { method: "DELETE" }),
  upsertDecision: (eventId: string, restaurantId: string, input: DecisionInput) =>
    request<{ decision: RestaurantDecision }>(
      `/api/events/${eventId}/restaurants/${restaurantId}/decisions/me`,
      { method: "PUT", body: JSON.stringify(input) }
    ),
  claimVerification: (eventId: string, verificationId: string) =>
    request<{ task: VerificationTask }>(`/api/events/${eventId}/verifications/${verificationId}/claim`, {
      method: "POST"
    }),
  releaseVerification: (eventId: string, verificationId: string) =>
    request<{ task: VerificationTask }>(`/api/events/${eventId}/verifications/${verificationId}/release`, {
      method: "POST"
    }),
  completeVerification: (eventId: string, verificationId: string, input: CompleteVerificationInput) =>
    request<{ task: VerificationTask; evidence: HumanEvidence }>(
      `/api/events/${eventId}/verifications/${verificationId}/complete`,
      { method: "POST", body: JSON.stringify(input) }
    ),
  respondPreferencePrompt: (eventId: string, promptId: string, accepted: boolean) =>
    request<{ prompt: PreferencePrompt }>(`/api/events/${eventId}/preference-prompts/${promptId}/respond`, {
      method: "POST",
      body: JSON.stringify({ accepted })
    })
};

export interface ChatMessage {
  id: string;
  eventId: string;
  sender: { type: "user"; userId: string } | { type: "council" } | { type: "system" };
  messageType: string;
  text?: string;
  relatedRestaurantId?: string;
  relatedActionId?: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
}

export interface VerificationTask {
  id: string;
  eventId: string;
  restaurantId: string;
  requirementType: string;
  requirementValue?: unknown;
  question: string;
  status: "open" | "claimed" | "completed" | "cancelled";
  assignedToUserId?: string;
  createdAt: string;
}

export interface HumanEvidence {
  id: string;
  restaurantId: string;
  requirementType: string;
  requirementValue?: unknown;
  providedByUserId: string;
  method: string;
  result: string;
  notes?: string;
  verifiedAt: string;
  visibility: "event" | "private";
}

export interface RestaurantDecision {
  id: string;
  restaurantId: string;
  userId: string;
  decision: "approve" | "prefer" | "neutral" | "dislike" | "reject";
  reasonCategory?: string;
  note?: string;
  visibility: "event" | "private";
}

export interface CouncilAction {
  id: string;
  eventId: string;
  restaurantId?: string;
  actorUserId?: string;
  type: string;
  visibility: "event" | "private";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PreferencePrompt {
  id: string;
  userId: string;
  question: string;
  status: "pending" | "accepted" | "declined";
}

export interface DecisionInput {
  decision: RestaurantDecision["decision"];
  reasonCategory?: string;
  note?: string;
  visibility?: "event" | "private";
}

export interface CompleteVerificationInput {
  result: "supports" | "contradicts" | "uncertain";
  method: "phone" | "in-person" | "email" | "website" | "other";
  notes?: string;
  visibility?: "event" | "private";
}

export interface CollaborationState {
  chat: ChatMessage[];
  tasks: VerificationTask[];
  evidence: HumanEvidence[];
  decisions: RestaurantDecision[];
  actions: CouncilAction[];
  prompts: PreferencePrompt[];
}

export interface EventCreationIntent {
  eventType: "restaurant";
  title?: string;
  date?: string;
  time?: { time?: string; approximate?: boolean; dayPart?: string };
  partySize?: number;
  location?: {
    query: string;
    radiusMiles?: number;
    resolvedLocation?: {
      displayName: string;
      latitude: number;
      longitude: number;
      providerPlaceId?: string;
      source?: string;
    };
  };
  cuisines?: Array<{ value: string; strength: string; polarity?: string }>;
  dietaryRequirements?: Array<{ requirement: string; strength: string }>;
  price?: { maxPerPerson?: number; strength: string; description?: string };
  requirements?: Array<{ type: string; strength: string }>;
  invitees?: Array<{ displayName?: string; email?: string }>;
  missingFields: Array<{ field: string; required: boolean; reason?: string }>;
  ambiguities: Array<{ field: string; description: string; candidates?: unknown[] }>;
  source: "natural-language" | "form";
}

export interface EventCreationResult {
  intent: EventCreationIntent;
  questions: string[];
  summary: string;
  readyToCreate: boolean;
  command?: {
    name: string;
    date?: string;
    locationLabel: string;
    radiusMiles: number;
    searchArea: EventSearchArea;
  };
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
  fallbackToForm?: boolean;
}

export interface User {
  id: string;
  displayName?: string;
  email?: string;
}

export interface EventSearchArea {
  displayName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  source?: string;
  providerPlaceId?: string;
}

export interface EventSummary {
  id: string;
  ownerId: string;
  name: string;
  date?: string;
  locationLabel?: string;
  searchArea?: EventSearchArea;
  status: string;
}

export interface Member {
  eventId: string;
  userId: string;
  role: string;
  status: string;
  displayName?: string;
  email?: string;
}

export interface Invitation {
  id: string;
  type: string;
  destination: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
}

export interface Preference {
  id: string;
  userId: string;
  category: string;
  visibility: "PUBLIC" | "PRIVATE";
  priority: string;
  value?: Record<string, unknown>;
  sourceText?: string;
}

export interface CouncilSnapshot {
  sessionId: string;
  eventId: string;
  status: string;
  participants: { userId: string; displayName: string; agentId: string }[];
  constraints: Array<{
    id: string;
    participantId: string;
    type: string;
    value: unknown;
    priority: string;
    visibility: string;
  }>;
  candidates: Array<{
    id: string;
    name: string;
    priceLevel?: number;
    priceRange?: {
      startAmount?: number;
      endAmount?: number;
      currencyCode?: string;
    };
    rating?: number;
    reviewCount?: number;
    cuisines: string[];
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    distanceKm?: number;
    outdoorSeating?: boolean;
    dietaryOptions?: string[];
    accessibility?: string[];
    photos?: RestaurantPhoto[];
    reviews?: RestaurantReview[];
    providerAttribution?: string;
    dietaryAssessments?: Array<{
      restaurantId: string;
      requirement: string;
      status: "confirmed" | "likely" | "uncertain" | "unsupported" | "conflicting";
      confidence: number;
      evidence: Array<{
        id: string;
        sourceType: string;
        sourceUrl?: string;
        sourceName?: string;
        excerpt?: string;
        supports: "supports" | "contradicts" | "neutral";
        reliability: "high" | "medium" | "low";
      }>;
      analyzedAt: string;
    }>;
  }>;
  evaluations: Array<{
    candidateId: string;
    participantId: string;
    score: number;
    label: string;
    reasonCode: string;
    rejected: boolean;
    privateConflict: boolean;
  }>;
  recommendations: Array<{
    candidate: CouncilSnapshot["candidates"][number];
    councilScore: number;
    evaluations: CouncilSnapshot["evaluations"];
    explanations: string[];
    rejected: boolean;
    rejectionSummary?: string;
    rejectionReasons?: Array<{
      participantId: string;
      constraintType: string;
      priority: string;
      required: unknown;
      actual: unknown;
      summary: string;
    }>;
  }>;
  events: Array<{ type: string; at: string; message: string }>;
  progress?: {
    phase: string;
    step: string;
    stepIndex?: number;
    stepCount?: number;
    agent?: { kind: "personal" | "negotiator" | "council"; name: string; userId?: string };
    tool?: { id: string; name: string };
    detail?: string;
    startedAt: string;
    sessionStartedAt: string;
    completedAt?: string;
  };
  error?: string;
}

export interface RestaurantPhoto {
  provider: "google" | "mock";
  providerPhotoId: string;
  width?: number;
  height?: number;
  attribution?: string;
}

export interface RestaurantReview {
  provider: "google" | "mock";
  providerReviewId?: string;
  rating?: number;
  text?: string;
  authorName?: string;
  relativeTimeDescription?: string;
  publishedAt?: string;
  attribution?: string;
}

export interface AuditRow {
  id: string;
  action: string;
  actorType: string;
  actorId: string;
  decision?: string;
  reason?: string;
  createdAt: string;
}

export interface AuthzDemo {
  name: string;
  allowed: boolean;
  code: string;
  reason: string;
}
