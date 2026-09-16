import { describe, expect, it } from "vitest";
import { interpretPreferenceNotes, parseFreeform } from "@rc/agents";

describe("natural-language preference notes", () => {
  it("keeps only the constraint before keep-it-quiet private", async () => {
    const drafts = await interpretPreferenceNotes({
      text: "I need dairy-free and under $30. Keep it quiet.",
      requestedVisibility: "PUBLIC"
    });
    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "dietary", visibility: "PUBLIC" }),
        expect.objectContaining({
          category: "price",
          visibility: "PRIVATE",
          value: { maxPriceLevel: 2 }
        })
      ])
    );
    expect(drafts.filter((item) => item.visibility === "PRIVATE")).toHaveLength(1);
  });

  it("does not privatize or duplicate constraints mentioned after keep it quiet", async () => {
    const drafts = await interpretPreferenceNotes({
      text: "I need it to be under $30. Please keep it quiet. I also can't have gluten.",
      requestedVisibility: "PUBLIC",
      runtime: {
        completeStructured: async () => ({
          publicConstraints: [
            { type: "MAX_PRICE_LEVEL", value: 2, priority: "HIGH" },
            {
              type: "DIETARY",
              value: [{ requirement: "gluten-free", strength: "required", evidenceRequirement: "normal" }],
              priority: "HARD"
            }
          ],
          privateConstraints: [
            {
              type: "DIETARY",
              value: [{ requirement: "gluten-free", strength: "required", evidenceRequirement: "strict" }],
              priority: "HARD"
            }
          ]
        })
      }
    });
    expect(drafts.filter((item) => item.category === "dietary")).toHaveLength(1);
    expect(drafts.find((item) => item.category === "price")?.visibility).toBe("PRIVATE");
    expect(drafts.find((item) => item.category === "dietary")?.visibility).toBe("PUBLIC");
    expect(drafts.find((item) => item.category === "dietary")?.summary.toLowerCase()).toContain("gluten");
  });

  it("treats don't-tell language the same as keep it quiet", async () => {
    const drafts = await interpretPreferenceNotes({
      text: "I need dairy-free and under $30. Don't tell everybody.",
      requestedVisibility: "PUBLIC"
    });
    const price = drafts.find((item) => item.category === "price");
    const dietary = drafts.find((item) => item.category === "dietary");
    expect(dietary?.visibility).toBe("PUBLIC");
    expect(price?.visibility).toBe("PRIVATE");
  });

  it("keeps a public cuisine preference public when asked", async () => {
    const drafts = await interpretPreferenceNotes({
      text: "I like steak",
      requestedVisibility: "PUBLIC"
    });
    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "cuisine",
          visibility: "PUBLIC",
          value: { cuisines: ["steak"] }
        })
      ])
    );
  });

  it("falls back to a freeform note when nothing structured is found", async () => {
    const drafts = await interpretPreferenceNotes({
      text: "Surprise me",
      requestedVisibility: "PRIVATE"
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.category).toBe("freeform");
    expect(drafts[0]?.visibility).toBe("PRIVATE");
    expect(drafts[0]?.sourceText).toBe("Surprise me");
  });

  it("parseFreeform still extracts outdoor seating", () => {
    expect(parseFreeform("we'd like outdoor seating").some((item) => item.type === "OUTDOOR_SEATING")).toBe(
      true
    );
  });
});
