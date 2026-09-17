import { fetchWithTimeout } from "../http.ts";

const MAX_CHARS = 40_000;

export interface FetchedRestaurantPage {
  url: string;
  text: string;
  links: string[];
  jsonLd: unknown[];
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const pattern = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    try {
      const resolved = new URL(match[1], baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        links.push(resolved.toString());
      }
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return [...new Set(links)];
}

export function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      // Ignore invalid JSON-LD.
    }
  }
  return blocks;
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ).slice(0, MAX_CHARS);
}

export async function fetchRestaurantPage(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<FetchedRestaurantPage | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const response = await fetchWithTimeout(fetchImpl, url, { method: "GET", redirect: "follow" }, 6000);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (/pdf|image\//i.test(contentType)) return null;
    const html = await response.text();
    const finalUrl = response.url || url;
    return {
      url: finalUrl,
      text: stripHtml(html),
      links: extractLinks(html, finalUrl),
      jsonLd: extractJsonLd(html)
    };
  } catch {
    return null;
  }
}
