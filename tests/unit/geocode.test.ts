import { describe, expect, it } from "vitest";
import { GoogleLocationResolver } from "@rc/tools";

describe("Google location autocomplete", () => {
  it("does not restrict suggestions to a subset of place types", async () => {
    let body = "";
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: "places/abc",
                text: { text: "Hard Rock Stadium" }
              }
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const resolver = new GoogleLocationResolver("test-key", fetchImpl);
    const suggestions = await resolver.suggest("Hard Rock Stadium");
    expect(suggestions[0]?.displayName).toBe("Hard Rock Stadium");
    expect(body).toContain('"input":"Hard Rock Stadium"');
    expect(body).not.toContain("includedPrimaryTypes");
  });
});
