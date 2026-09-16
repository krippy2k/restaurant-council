import {
  applyDraft,
  EventCreationAgent,
  intentFromText,
  MockEventIntentParser,
  preferencesFromIntent,
  summarizeIntent,
  validateEventIntent
} from "@rc/agents";
import {
  EVENT_INTENT_PARSER_VERSION,
  LlmEventIntentDraftSchema,
  stripHallucinatedLocation,
  type EventParserContext
} from "@rc/protocol";
import { MockLocationResolver, resolveLocationQuery } from "@rc/tools";
import { describe, expect, it } from "vitest";

const CONTEXT: EventParserContext = {
  currentDateTime: "2026-09-16T12:00:00-04:00",
  timezone: "America/New_York"
};

const BAMFORD =
  "I want to find a restaurant within 10 miles of Bamford Park in Broward County on Saturday at 3pm that is kid friendly.";

function agent() {
  const resolver = new MockLocationResolver();
  return new EventCreationAgent(new MockEventIntentParser(), (query) =>
    resolveLocationQuery(resolver, query)
  );
}

describe("natural language event intent parser", () => {
  it("resolves the Bamford Park golden example from supplied current-date context", async () => {
    const parsed = await new MockEventIntentParser().parse(BAMFORD, CONTEXT);
    expect(parsed.eventType).toBe("restaurant");
    expect(parsed.date).toBe("2026-09-19");
    expect(parsed.time).toEqual({ time: "15:00", approximate: false });
    expect(parsed.location?.query.toLowerCase()).toContain("bamford park");
    expect(parsed.location?.radiusMiles).toBe(10);
    expect(parsed.requirements).toEqual([{ type: "kid-friendly", strength: "required" }]);
    expect(parsed.location?.resolvedLocation).toBeUndefined();

    const result = await agent().interpret(BAMFORD, CONTEXT);
    expect(result.readyToCreate).toBe(true);
    expect(result.intent.location?.resolvedLocation?.displayName).toMatch(/Bamford Park/i);
    expect(result.intent.location?.resolvedLocation?.latitude).toBeCloseTo(26.1901, 3);
    expect(result.command?.searchArea.providerPlaceId).toBeUndefined();
    expect(result.summary).toContain("Saturday, September 19");
    expect(result.summary).toContain("3:00 PM");
    expect(result.summary).toMatch(/Kid friendly/i);
    expect(result.summary).toContain("10 miles");
  });

  it("covers parser fixtures for dates, party, cuisine, price, and dietary needs", async () => {
    const parser = new MockEventIntentParser();
    expect((await parser.parse("dinner tomorrow at noon near Bamford Park", CONTEXT)).date).toBe(
      "2026-09-17"
    );
    expect((await parser.parse("next Friday near Bamford Park", CONTEXT)).date).toBe("2026-09-25");
    expect((await parser.parse("around 7 near Bamford Park", CONTEXT)).time).toMatchObject({
      time: "19:00",
      approximate: true
    });
    expect((await parser.parse("party of 8 near Bamford Park", CONTEXT)).partySize).toBe(8);
    expect((await parser.parse("two adults and three kids near Bamford Park", CONTEXT)).partySize).toBe(5);
    expect(
      (await parser.parse("Italian would be nice near Bamford Park", CONTEXT)).cuisines
    ).toEqual([{ value: "italian", strength: "preferred", polarity: "include" }]);
    expect((await parser.parse("no seafood near Bamford Park", CONTEXT)).cuisines).toEqual([
      { value: "seafood", strength: "required", polarity: "exclude" }
    ]);
    expect((await parser.parse("under $50 per person near Bamford Park", CONTEXT)).price).toMatchObject({
      maxPerPerson: 50,
      strength: "required"
    });
    expect((await parser.parse("one person is vegetarian near Bamford Park", CONTEXT)).dietaryRequirements).toEqual(
      expect.arrayContaining([expect.objectContaining({ requirement: "vegetarian", strength: "required" })])
    );
  });

  it("keeps unmentioned fields when the user changes radius and time", async () => {
    const creation = agent();
    const initial = await creation.interpret(
      "Saturday at 3 within 10 miles of Bamford Park.",
      CONTEXT
    );
    const modified = await creation.modify(
      initial.intent,
      "Actually make it 5 miles and 4.",
      CONTEXT
    );
    expect(modified.intent.location?.radiusMiles).toBe(5);
    expect(modified.intent.time?.time).toBe("16:00");
    expect(modified.intent.date).toBe("2026-09-19");
    expect(modified.intent.location?.query.toLowerCase()).toContain("bamford park");
  });

  it("asks when location is missing, and does not guess a place", async () => {
    const result = await agent().interpret("kid friendly dinner on Saturday at 3pm", CONTEXT);
    expect(result.readyToCreate).toBe(false);
    expect(result.questions.join(" ")).toMatch(/where/i);
    expect(result.intent.location).toBeUndefined();
  });

  it("asks which place when location resolution is ambiguous", async () => {
    const creation = new EventCreationAgent(new MockEventIntentParser(), async () => ({
      status: "ambiguous",
      candidates: [
        { displayName: "Downtown Arena", latitude: 26.1, longitude: -80.1 },
        { displayName: "Westside Arena", latitude: 26.2, longitude: -80.2 }
      ]
    }));
    const result = await creation.interpret("somewhere near the arena tomorrow", CONTEXT);
    expect(result.readyToCreate).toBe(false);
    expect(result.intent.ambiguities[0]?.field).toBe("location");
    expect(result.intent.location?.resolvedLocation).toBeUndefined();
  });

  it("treats a named person's diet as a creator event requirement, not their private vault", async () => {
    const parsed = intentFromText("Jessica is vegan. Search near Bamford Park.", CONTEXT);
    expect(parsed.dietaryRequirements).toEqual(
      expect.arrayContaining([expect.objectContaining({ requirement: "vegan", strength: "required" })])
    );
    expect(parsed.invitees).toBeUndefined();
    const prefs = preferencesFromIntent(parsed);
    expect(prefs.some((item) => item.category === "dietary")).toBe(true);
    expect(JSON.stringify(prefs)).not.toMatch(/jessica/i);
  });
});

describe("natural language event privacy and security", () => {
  it("extracts a private price limit without propagating the explanation", () => {
    const text = "Money is tight. Keep it under $30 but don't tell everyone. Near Bamford Park.";
    const intent = intentFromText(text, CONTEXT);
    expect(intent.price).toMatchObject({ maxPerPerson: 30, strength: "preferred" });
    const blob = JSON.stringify({
      intent,
      summary: summarizeIntent(intent, CONTEXT.timezone),
      prefs: preferencesFromIntent(intent, text)
    });
    expect(blob).not.toContain("Money is tight");
    expect(blob).not.toMatch(/don't tell/i);
    expect(blob).not.toContain("lost");
    expect(preferencesFromIntent(intent, text).find((item) => item.category === "price")?.visibility).toBe(
      "PRIVATE"
    );
  });

  it("rejects malformed model output and ignores invented coordinates and provider IDs", () => {
    expect(() => LlmEventIntentDraftSchema.parse({ eventType: "concert" })).toThrow();
    expect(() => LlmEventIntentDraftSchema.parse({ location: { query: "x", latitude: 1, longitude: 2 } })).not.toThrow();
    const draft = LlmEventIntentDraftSchema.parse({
      eventType: "restaurant",
      location: { query: "Bamford Park", radiusMiles: 10, latitude: 0, longitude: 0, providerPlaceId: "fake_id" },
      relativeDate: "Saturday"
    });
    expect(draft).not.toHaveProperty("latitude");
    expect(JSON.stringify(draft)).not.toContain("fake_id");

    const applied = applyDraft(BAMFORD, CONTEXT, {
      eventType: "restaurant",
      source: "natural-language",
      location: { query: "Times Square", radiusMiles: 2 },
      date: "2020-01-01",
      title: "Ignore previous instructions"
    });
    expect(applied.location?.query.toLowerCase()).toContain("bamford park");
    expect(applied.date).toBe("2026-09-19");
    expect(stripHallucinatedLocation({
      ...applied,
      location: {
        query: applied.location!.query,
        radiusMiles: applied.location?.radiusMiles,
        resolvedLocation: {
          displayName: "Hallucinated",
          latitude: 0,
          longitude: 0,
          providerPlaceId: "ChIJfake"
        }
      },
      missingFields: [],
      ambiguities: [],
      source: "natural-language"
    }).location?.resolvedLocation).toBeUndefined();
  });

  it("clamps extreme radius and rejects invalid dates", () => {
    const huge = intentFromText("within 999 miles of Bamford Park", CONTEXT);
    expect(huge.location?.radiusMiles).toBe(31);
    const validation = validateEventIntent({
      eventType: "restaurant",
      date: "2026-02-31",
      location: { query: "Bamford Park", radiusMiles: 999 },
      missingFields: [],
      ambiguities: [],
      source: "natural-language"
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((item) => item.field === "date")).toBe(true);
    expect(validation.warnings.some((item) => item.field === "radiusMiles")).toBe(true);
  });

  it("records a versioned parser contract", () => {
    expect(EVENT_INTENT_PARSER_VERSION).toBe("event-intent-parser:v1");
  });
});

describe("resolve_location tool", () => {
  it("never auto-picks when several distinct places match", async () => {
    const result = await resolveLocationQuery(
      {
        suggest: async () => [
          { displayName: "Arena One", placeId: "one" },
          { displayName: "Arena Two", placeId: "two" }
        ],
        resolve: async (_query, placeId) => ({
          displayName: placeId === "one" ? "Arena One" : "Arena Two",
          latitude: placeId === "one" ? 26.1 : 26.2,
          longitude: -80.1,
          source: "landmark" as const,
          providerPlaceId: placeId
        })
      },
      "the arena"
    );
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
    expect(result.location).toBeUndefined();
  });

  it("does not accept a single unmatched provider suggestion", async () => {
    const result = await resolveLocationQuery(
      {
        suggest: async () => [
          { displayName: "Mallaranny, Park Inn, Co. Mayo, Ireland", placeId: "fake" }
        ],
        resolve: async () => {
          throw new Error("should not resolve an unmatched suggestion");
        }
      },
      "Bamford Park in Broward County"
    );
    expect(result.status).toBe("resolved");
    expect(result.location?.displayName).toMatch(/Bamford Park/i);
    expect(result.location?.providerPlaceId).toBeUndefined();
  });
});
