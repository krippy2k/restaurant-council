import { fetchWithTimeout } from "../http.ts";

const MAX_CHARS = 40_000;
const EXTRA_PATHS = ["/menu", "/allergen", "/allergens", "/nutrition", "/faq"];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

export async function fetchWebsiteText(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const response = await fetchWithTimeout(fetchImpl, url, { method: "GET", redirect: "follow" }, 6000);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (/pdf|image\//i.test(contentType)) return null;
    const body = stripHtml(await response.text());
    return body || null;
  } catch {
    return null;
  }
}

export async function fetchOfficialRestaurantText(
  website: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const homepage = await fetchWebsiteText(website, fetchImpl);
  const chunks = [homepage].filter((item): item is string => Boolean(item));
  try {
    const origin = new URL(website).origin;
    for (const path of EXTRA_PATHS) {
      const extra = await fetchWebsiteText(new URL(path, origin).toString(), fetchImpl);
      if (extra) chunks.push(extra);
      if (chunks.join(" ").length > MAX_CHARS) break;
    }
  } catch {
    // Keep homepage text if extra paths cannot be resolved.
  }
  const combined = chunks.join(" ").trim();
  return combined ? combined.slice(0, MAX_CHARS) : null;
}
