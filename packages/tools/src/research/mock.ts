import { nowIso } from "@rc/shared";
import type { MenuItemEvidence, ToolExecutionContext } from "@rc/protocol";
import type { ResearchRestaurant, ResearchTool, ResearchToolDeps } from "./tools.ts";
import { createGetRestaurantDetailsTool, createSearchReviewsTool } from "./tools.ts";

export const MOCK_SPORTS_GRILL_MENU: MenuItemEvidence[] = [
  {
    id: "mitm_fried_shrimp_basket",
    restaurantId: "res_sports_grill",
    name: "Fried Shrimp Basket",
    description: "Fried shrimp served with fries and coleslaw",
    price: 16.99,
    currency: "USD",
    sourceUrl: "https://sportsgrill.example.com/menu",
    sourceType: "official-menu",
    retrievedAt: "2026-09-17T12:00:00.000Z",
    confidence: "confirmed"
  },
  {
    id: "mitm_wings",
    restaurantId: "res_sports_grill",
    name: "Wings",
    description: "One pound of chicken wings",
    price: 14.99,
    currency: "USD",
    sourceUrl: "https://sportsgrill.example.com/menu",
    sourceType: "official-menu",
    retrievedAt: "2026-09-17T12:00:00.000Z",
    confidence: "confirmed"
  }
];

export function mockMenuFor(restaurant: ResearchRestaurant): MenuItemEvidence[] {
  const lower = restaurant.name.toLowerCase();
  if (lower.includes("sports grill") || restaurant.id === "res_sports_grill") {
    return MOCK_SPORTS_GRILL_MENU.map((item) => ({ ...item, restaurantId: restaurant.id, retrievedAt: nowIso() }));
  }
  if (lower.includes("flanigan")) {
    return [
      {
        id: "mitm_flanigan_shrimp",
        restaurantId: restaurant.id,
        name: "Fried Shrimp",
        description: "Breaded shrimp with fries",
        price: 18.5,
        currency: "USD",
        sourceUrl: "https://flanigans.example.com/menu",
        sourceType: "official-menu",
        retrievedAt: nowIso(),
        confidence: "confirmed"
      }
    ];
  }
  return [];
}

export function createMockSearchMenuTool(
  deps: Pick<ResearchToolDeps, "getRestaurant">
): ResearchTool<{ restaurantId: string; query: string }, { items: MenuItemEvidence[] }> {
  return {
    name: "search_menu",
    description: "Search known menu sources for menu items matching a query.",
    async execute(input, context: ToolExecutionContext) {
      const restaurant = await deps.getRestaurant(input.restaurantId, context);
      if (!restaurant) return { items: [] };
      const query = input.query.toLowerCase();
      const items = mockMenuFor(restaurant).filter((item) =>
        `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.replace(/[^\p{L}\p{N}\s]/gu, " ").trim()) ||
        query.split(/\s+/).filter((token) => token.length > 3).every((token) =>
          `${item.name} ${item.description ?? ""}`.toLowerCase().includes(token)
        )
      );
      return { items };
    }
  };
}

export function createMockGetMenuTool(
  deps: Pick<ResearchToolDeps, "getRestaurant">
): ResearchTool<{ restaurantId: string }, { items: MenuItemEvidence[]; excerpt?: string; sourceUrl?: string }> {
  return {
    name: "get_menu",
    description: "Retrieve the best available menu for a restaurant.",
    async execute(input, context) {
      const restaurant = await deps.getRestaurant(input.restaurantId, context);
      if (!restaurant) return { items: [] };
      const items = mockMenuFor(restaurant);
      return {
        items,
        excerpt: items.map((item) => item.name).join(", "),
        sourceUrl: items[0]?.sourceUrl
      };
    }
  };
}

export function createMockResearchTools(deps: ResearchToolDeps): ResearchTool<unknown, unknown>[] {
  const web: ResearchTool<
    { restaurantId: string; query: string },
    { excerpt?: string; sourceUrl?: string; links: string[] }
  > = {
    name: "search_restaurant_web",
    description: "Perform targeted web research about the resolved restaurant website.",
    async execute(input, context) {
      const restaurant = await deps.getRestaurant(input.restaurantId, context);
      if (!restaurant) return { links: [] };
      return {
        excerpt: restaurant.website ? `${restaurant.name} website mentions ${input.query}.` : undefined,
        sourceUrl: restaurant.website,
        links: restaurant.website ? [`${restaurant.website.replace(/\/$/, "")}/reservations`] : []
      };
    }
  };
  const reservations: ResearchTool<
    { restaurantId: string },
    { links: Array<{ provider: string; url: string; label: string }>; caveat: string }
  > = {
    name: "discover_reservation_links",
    description: "Discover verified public reservation links. Does not check live availability.",
    async execute(input, context) {
      const restaurant = await deps.getRestaurant(input.restaurantId, context);
      if (!restaurant?.website) {
        return {
          links: [],
          caveat: "A reservation page was found. This does not mean a specific date, time, or party size is available."
        };
      }
      return {
        links: [
          {
            provider: "opentable",
            url: "https://www.opentable.com/r/sports-grill-example",
            label: "Reserve on OpenTable"
          }
        ],
        caveat: "A reservation page was found. This does not mean a specific date, time, or party size is available."
      };
    }
  };
  return [
    createMockSearchMenuTool(deps),
    createMockGetMenuTool(deps),
    createGetRestaurantDetailsTool(deps),
    web,
    createSearchReviewsTool(deps),
    reservations
  ] as ResearchTool<unknown, unknown>[];
}
