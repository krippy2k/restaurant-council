import { AppError, ErrorCodes, nowIso } from "@rc/shared";
import {
  MenuItemEvidenceSchema,
  rankEvidenceSource,
  type MenuItemEvidence,
  type RestaurantEvidence,
  type ToolExecutionContext
} from "@rc/protocol";
import { fetchRestaurantPage } from "./fetch-page.ts";
import { excerptAroundQuery, menuItemsFromPage, menuPathCandidates } from "./menu.ts";
import { discoverReservationLinks, reservationDoesNotImplyAvailability } from "./reservation-links.ts";

export interface ResearchRestaurant {
  id: string;
  name: string;
  address?: string;
  website?: string;
  phone?: string;
  outdoorSeating?: boolean;
  priceLevel?: number;
  rating?: number;
  reviewCount?: number;
  reviews?: Array<{ text?: string; rating?: number; authorName?: string }>;
  dietaryAssessments?: Array<{
    requirement: string;
    status: string;
    confidence?: number;
    evidence?: Array<{ sourceType?: string; sourceUrl?: string; excerpt?: string }>;
  }>;
  latitude?: number;
  longitude?: number;
  hours?: string;
  hoursWeekdayText?: string[];
  openingHours?: { weekdayText?: string[]; timeZone?: string };
}

export interface ResearchTool<TInput, TOutput> {
  name: string;
  description: string;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

export interface CachedEvidence {
  key: string;
  payload: unknown;
  retrievedAt: string;
  expiresAt: string;
}

export interface ResearchCache {
  get(key: string): Promise<CachedEvidence | null>;
  set(entry: CachedEvidence): Promise<void>;
}

export interface ResearchToolDeps {
  getRestaurant: (restaurantId: string, context: ToolExecutionContext) => Promise<ResearchRestaurant | null>;
  fetchImpl?: typeof fetch;
  cache?: ResearchCache;
  now?: () => number;
}

const MENU_TTL_MS = 24 * 60 * 60 * 1000;
const WEB_TTL_MS = 12 * 60 * 60 * 1000;
const RESERVATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const DETAILS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function assertAuthorized(context: ToolExecutionContext): void {
  if (!context.authorized) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Not authorized to use research tools", 403);
  }
}

async function requireRestaurant(
  deps: ResearchToolDeps,
  restaurantId: string,
  context: ToolExecutionContext
): Promise<ResearchRestaurant> {
  assertAuthorized(context);
  const restaurant = await deps.getRestaurant(restaurantId, context);
  if (!restaurant) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Restaurant is not in this event", 404);
  }
  return restaurant;
}

async function cached<T>(
  deps: ResearchToolDeps,
  key: string,
  ttlMs: number,
  load: () => Promise<T>
): Promise<T> {
  const existing = await deps.cache?.get(key);
  const now = deps.now?.() ?? Date.now();
  if (existing && Date.parse(existing.expiresAt) > now) {
    return existing.payload as T;
  }
  const payload = await load();
  const retrievedAt = new Date(now).toISOString();
  await deps.cache?.set({
    key,
    payload,
    retrievedAt,
    expiresAt: new Date(now + ttlMs).toISOString()
  });
  return payload;
}

export function createSearchMenuTool(deps: ResearchToolDeps): ResearchTool<{ restaurantId: string; query: string }, { items: MenuItemEvidence[] }> {
  return {
    name: "search_menu",
    description: "Search known menu sources for menu items matching a query.",
    async execute(input, context) {
      const restaurant = await requireRestaurant(deps, input.restaurantId, context);
      const items = await cached(deps, `menu:${restaurant.id}:${input.query.toLowerCase()}`, MENU_TTL_MS, async () => {
        const found: MenuItemEvidence[] = [];
        if (!restaurant.website) return found;
        const fetchImpl = deps.fetchImpl ?? fetch;
        for (const url of menuPathCandidates(restaurant.website).slice(0, 3)) {
          const page = await fetchRestaurantPage(url, fetchImpl);
          if (!page) continue;
          found.push(...menuItemsFromPage(page, restaurant.id, input.query));
          if (found.length) break;
        }
        return found;
      });
      return { items: items.map((item) => MenuItemEvidenceSchema.parse(item)) };
    }
  };
}

export function createGetMenuTool(deps: ResearchToolDeps): ResearchTool<{ restaurantId: string }, { items: MenuItemEvidence[]; excerpt?: string; sourceUrl?: string }> {
  return {
    name: "get_menu",
    description: "Retrieve the best available menu for a restaurant.",
    async execute(input, context) {
      const restaurant = await requireRestaurant(deps, input.restaurantId, context);
      return cached(deps, `menu-all:${restaurant.id}`, MENU_TTL_MS, async () => {
        if (!restaurant.website) return { items: [] as MenuItemEvidence[] };
        const fetchImpl = deps.fetchImpl ?? fetch;
        for (const url of menuPathCandidates(restaurant.website).slice(0, 3)) {
          const page = await fetchRestaurantPage(url, fetchImpl);
          if (!page) continue;
          const items = menuItemsFromPage(page, restaurant.id);
          if (items.length || page.text) {
            return {
              items,
              excerpt: page.text.slice(0, 1200),
              sourceUrl: page.url
            };
          }
        }
        return { items: [] as MenuItemEvidence[] };
      });
    }
  };
}

export function createGetRestaurantDetailsTool(
  deps: ResearchToolDeps
): ResearchTool<{ restaurantId: string }, ResearchRestaurant & { checkedAt: string }> {
  return {
    name: "get_restaurant_details",
    description: "Retrieve structured restaurant metadata from the event restaurant record.",
    async execute(input, context) {
      const restaurant = await requireRestaurant(deps, input.restaurantId, context);
      return cached(deps, `details:${restaurant.id}`, DETAILS_TTL_MS, async () => ({
        ...restaurant,
        checkedAt: nowIso()
      }));
    }
  };
}

export function createSearchRestaurantWebTool(
  deps: ResearchToolDeps
): ResearchTool<{ restaurantId: string; query: string }, { excerpt?: string; sourceUrl?: string; links: string[] }> {
  return {
    name: "search_restaurant_web",
    description: "Perform targeted web research about the resolved restaurant website.",
    async execute(input, context) {
      const restaurant = await requireRestaurant(deps, input.restaurantId, context);
      return cached(deps, `web:${restaurant.id}:${input.query.toLowerCase()}`, WEB_TTL_MS, async () => {
        if (!restaurant.website) return { links: [] as string[] };
        const page = await fetchRestaurantPage(restaurant.website, deps.fetchImpl ?? fetch);
        if (!page) return { links: [] as string[] };
        return {
          excerpt: excerptAroundQuery(page.text, input.query) ?? page.text.slice(0, 400),
          sourceUrl: page.url,
          links: page.links.slice(0, 20)
        };
      });
    }
  };
}

export function createSearchReviewsTool(
  deps: ResearchToolDeps
): ResearchTool<{ restaurantId: string; query: string }, { reviews: Array<{ text: string; rating?: number; authorName?: string }> }> {
  return {
    name: "search_reviews",
    description: "Search review evidence when stronger sources do not answer the question.",
    async execute(input, context) {
      const restaurant = await requireRestaurant(deps, input.restaurantId, context);
      const tokens = input.query.toLowerCase().split(/\s+/).filter((token) => token.length > 3);
      const reviews = (restaurant.reviews ?? [])
        .filter((review) => {
          const text = review.text?.toLowerCase() ?? "";
          return tokens.length ? tokens.some((token) => text.includes(token)) : Boolean(text);
        })
        .slice(0, 5)
        .map((review) => ({
          text: (review.text ?? "").slice(0, 400),
          rating: review.rating,
          authorName: review.authorName
        }));
      return { reviews };
    }
  };
}

export function createDiscoverReservationLinksTool(
  deps: ResearchToolDeps
): ResearchTool<
  { restaurantId: string },
  { links: Array<{ provider: string; url: string; label: string }>; caveat: string }
> {
  return {
    name: "discover_reservation_links",
    description: "Discover verified public reservation links. Does not check live availability.",
    async execute(input, context) {
      const restaurant = await requireRestaurant(deps, input.restaurantId, context);
      return cached(deps, `reserve:${restaurant.id}`, RESERVATION_TTL_MS, async () => {
        if (!restaurant.website) {
          return { links: [], caveat: reservationDoesNotImplyAvailability() };
        }
        const page = await fetchRestaurantPage(restaurant.website, deps.fetchImpl ?? fetch);
        const links = page ? discoverReservationLinks({ links: page.links, text: page.text }) : [];
        return { links, caveat: reservationDoesNotImplyAvailability() };
      });
    }
  };
}

export function evidenceFromMenuItems(items: MenuItemEvidence[]): RestaurantEvidence[] {
  return items
    .slice()
    .sort((left, right) => rankEvidenceSource(left.sourceType) - rankEvidenceSource(right.sourceType))
    .map((item) => ({
      id: item.id,
      restaurantId: item.restaurantId,
      sourceType: item.sourceType,
      sourceName: item.sourceType === "official-menu" ? "Official Menu" : "Restaurant website",
      sourceUrl: item.sourceUrl,
      summary: [item.name, item.description, item.price != null ? `$${item.price.toFixed(2)}` : "price not confirmed"]
        .filter(Boolean)
        .join(" — "),
      retrievedAt: item.retrievedAt
    }));
}

export function createResearchTools(deps: ResearchToolDeps): ResearchTool<unknown, unknown>[] {
  return [
    createSearchMenuTool(deps),
    createGetMenuTool(deps),
    createGetRestaurantDetailsTool(deps),
    createSearchRestaurantWebTool(deps),
    createSearchReviewsTool(deps),
    createDiscoverReservationLinksTool(deps)
  ];
}

export function createResearchToolRegistry(tools: ResearchTool<unknown, unknown>[]) {
  const map = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    descriptions() {
      return tools.map((tool) => ({ name: tool.name, description: tool.description }));
    },
    async execute(name: string, input: unknown, context: ToolExecutionContext) {
      const tool = map.get(name);
      if (!tool) throw new AppError(ErrorCodes.VALIDATION, `Unknown research tool: ${name}`, 400);
      return tool.execute(input as never, context);
    }
  };
}
