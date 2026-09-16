import { assertAuthorized, type Principal } from "@rc/auth";
import { AppError, ErrorCodes } from "@rc/shared";
import type { RestaurantSearchQuery, RestaurantSearchTool } from "@rc/tools";

export interface McpToolDefinition {
  name: string;
  description: string;
  actions: Array<"restaurant.search" | "restaurant.get">;
}

export const RESTAURANT_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "search_restaurants",
    description: "Search nearby restaurants using the configured provider.",
    actions: ["restaurant.search"]
  },
  {
    name: "get_restaurant_details",
    description: "Get richer restaurant details for a Restaurant Council restaurant id.",
    actions: ["restaurant.get"]
  },
  {
    name: "get_restaurant",
    description: "Get a normalized restaurant record by id.",
    actions: ["restaurant.get"]
  },
  {
    name: "get_menu",
    description: "Get menu highlights for a restaurant when available.",
    actions: ["restaurant.get"]
  },
  {
    name: "get_hours",
    description: "Get opening hours for a restaurant.",
    actions: ["restaurant.get"]
  }
];

export class RestaurantMcpAdapter {
  constructor(private readonly restaurants: RestaurantSearchTool) {}

  listTools(): McpToolDefinition[] {
    return RESTAURANT_MCP_TOOLS;
  }

  async invoke(
    name: string,
    args: Record<string, unknown>,
    principal: Principal
  ): Promise<unknown> {
    const tool = RESTAURANT_MCP_TOOLS.find((item) => item.name === name);
    if (!tool) {
      throw new AppError(ErrorCodes.NOT_FOUND, `Unknown tool ${name}`, 404);
    }

    for (const action of tool.actions) {
      assertAuthorized({
        principal,
        action,
        resource: { type: "restaurant" }
      });
    }

    switch (name) {
      case "search_restaurants":
        return this.restaurants.search(args as unknown as RestaurantSearchQuery, principal);
      case "get_restaurant":
      case "get_restaurant_details":
      case "get_menu":
      case "get_hours": {
        const id = String(args.id ?? "");
        return this.restaurants.getRestaurant(id, principal);
      }
      default:
        throw new AppError(ErrorCodes.NOT_FOUND, `Unknown tool ${name}`, 404);
    }
  }
}
