import { createId, nowIso } from "@rc/shared";
import type { MenuItemEvidence, ResearchConfidence } from "@rc/protocol";
import type { FetchedRestaurantPage } from "./fetch-page.ts";

const PRICE = /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/;
const MENU_PATHS = ["/menu", "/menus", "/food", "/dinner", "/order"];

export interface ExtractedMenuItem {
  name: string;
  description?: string;
  price?: number;
  currency?: string;
}

function walkJsonLd(value: unknown, acc: ExtractedMenuItem[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) walkJsonLd(item, acc);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
  if (types.some((item) => /menuitem/i.test(item))) {
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (name) {
      const offers = record.offers as Record<string, unknown> | undefined;
      const priceRaw = offers?.price ?? record.price;
      const price = typeof priceRaw === "number" ? priceRaw : typeof priceRaw === "string" ? Number(priceRaw) : undefined;
      acc.push({
        name: name.slice(0, 160),
        description: typeof record.description === "string" ? record.description.slice(0, 400) : undefined,
        price: Number.isFinite(price) && (price as number) > 0 ? Number(price) : undefined,
        currency:
          typeof offers?.priceCurrency === "string"
            ? offers.priceCurrency
            : typeof record.priceCurrency === "string"
              ? record.priceCurrency
              : price
                ? "USD"
                : undefined
      });
    }
  }
  for (const nested of Object.values(record)) walkJsonLd(nested, acc);
}

export function extractMenuItemsFromJsonLd(blocks: unknown[]): ExtractedMenuItem[] {
  const items: ExtractedMenuItem[] = [];
  walkJsonLd(blocks, items);
  return dedupeItems(items);
}

export function extractMenuItemsFromText(text: string): ExtractedMenuItem[] {
  const items: ExtractedMenuItem[] = [];
  const pattern =
    /((?:[A-Z][A-Za-z0-9'&().]+\s+){0,7}[A-Z][A-Za-z0-9'&().]{2,})\s+(?:[-–—:|]\s*)?([^$]{0,140}?)\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const name = match[1].replace(/\s+/g, " ").trim();
    const description = match[2].replace(/\s+/g, " ").trim() || undefined;
    const price = Number(match[3].replaceAll(",", ""));
    if (name.split(" ").length > 10) continue;
    items.push({
      name: name.slice(0, 160),
      description: description?.slice(0, 400),
      price: Number.isFinite(price) ? price : undefined,
      currency: "USD"
    });
  }
  return dedupeItems(items);
}

function dedupeItems(items: ExtractedMenuItem[]): ExtractedMenuItem[] {
  const seen = new Set<string>();
  const out: ExtractedMenuItem[] = [];
  for (const item of items) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function queryMatchesItem(item: ExtractedMenuItem, query: string): boolean {
  const hay = `${item.name} ${item.description ?? ""}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
  if (!tokens.length) return hay.includes(query.toLowerCase().trim());
  return tokens.every((token) => hay.includes(token));
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "have",
  "has",
  "does",
  "what",
  "about",
  "their",
  "this",
  "that",
  "with",
  "from",
  "menu",
  "they",
  "any",
  "are",
  "how",
  "much",
  "want",
  "know",
  "whether",
  "please",
  "tell",
  "place",
  "restaurant"
]);

export function menuItemsFromPage(
  page: FetchedRestaurantPage,
  restaurantId: string,
  query?: string,
  confidence: ResearchConfidence = "likely"
): MenuItemEvidence[] {
  const extracted = [...extractMenuItemsFromJsonLd(page.jsonLd), ...extractMenuItemsFromText(page.text)];
  const matched = query?.trim() ? extracted.filter((item) => queryMatchesItem(item, query)) : extracted;
  const sourceType = /menu/i.test(page.url) ? "official-menu" : "official-website";
  return matched.slice(0, 12).map((item) => ({
    id: createId("mitm"),
    restaurantId,
    name: item.name,
    description: item.description,
    price: item.price,
    currency: item.price ? item.currency ?? "USD" : undefined,
    sourceUrl: page.url,
    sourceType,
    retrievedAt: nowIso(),
    confidence: item.price ? confidence : "likely"
  }));
}

export function menuPathCandidates(website: string): string[] {
  try {
    const origin = new URL(website).origin;
    return [website, ...MENU_PATHS.map((path) => new URL(path, origin).toString())];
  } catch {
    return [website];
  }
}

export function excerptAroundQuery(text: string, query: string, max = 280): string | undefined {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 3);
  const lower = text.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    index = lower.indexOf(token);
    if (index >= 0) break;
  }
  if (index < 0) {
    const price = PRICE.exec(text);
    if (!price || price.index == null) return undefined;
    index = price.index;
  }
  const start = Math.max(0, index - 80);
  return text.slice(start, start + max).replace(/\s+/g, " ").trim();
}
