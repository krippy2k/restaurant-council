import { Hono } from "hono";
import { CARD_PHOTO_MAX_WIDTH, clampPhotoDimension, restaurantToCandidate, validateSearchRequest } from "@rc/tools";
import { AppError, ErrorCodes } from "@rc/shared";
import type { Env } from "../env.ts";
import { createDietaryAnalyzer, createRestaurantService } from "../restaurants.ts";
import { requireUser, type AppVariables } from "./session.ts";

export const restaurantRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

restaurantRoutes.post("/search", async (c) => {
  const identity = requireUser(c);
  const allowed = await c.get("db").consumeRateLimit(
    `restaurant-search:${identity.userId}`,
    30,
    60 * 60 * 1000
  );
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many restaurant searches", 429);
  const body = await c.req.json();
  const request = validateSearchRequest(body);
  const service = createRestaurantService(c.env, c.get("db"));
  const result = await service.search(request);
  await c.get("db").recordRestaurantSearch({
    provider: result.search.provider,
    location: request.location,
    radius: request.radiusMeters,
    constraints: {
      cuisines: request.cuisines,
      priceLevels: request.priceLevels,
      dietaryRequirements: request.dietaryRequirements
    },
    query: request.textQuery,
    resultCount: result.restaurants.length
  });
  return c.json({
    restaurants: result.restaurants.map((restaurant) =>
      restaurantToCandidate(restaurant, request.location)
    ),
    search: result.search
  });
});

restaurantRoutes.get("/:restaurantId/photos/:photoId", async (c) => {
  const identity = requireUser(c);
  const allowed = await c.get("db").consumeRateLimit(
    `restaurant-photo:${identity.userId}`,
    120,
    60 * 60 * 1000
  );
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many photo requests", 429);
  const width = clampPhotoDimension(Number(c.req.query("w") ?? CARD_PHOTO_MAX_WIDTH), CARD_PHOTO_MAX_WIDTH);
  const height = c.req.query("h") ? clampPhotoDimension(Number(c.req.query("h"))) : undefined;
  const service = createRestaurantService(c.env, c.get("db"));
  const photo = await service.resolvePhoto(c.req.param("restaurantId"), c.req.param("photoId"), {
    maxWidth: width,
    maxHeight: height
  });
  if (photo.kind === "redirect") {
    c.header("Cache-Control", `public, max-age=${photo.cacheSeconds}`);
    return c.redirect(photo.url, 302);
  }
  return new Response(photo.body, {
    headers: {
      "content-type": photo.contentType,
      "cache-control": `public, max-age=${photo.cacheSeconds}`,
      "x-content-type-options": "nosniff"
    }
  });
});

restaurantRoutes.post("/:restaurantId/dietary-analysis", async (c) => {
  const identity = requireUser(c);
  const allowed = await c.get("db").consumeRateLimit(
    `dietary-analysis:${identity.userId}`,
    20,
    60 * 60 * 1000
  );
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many dietary analysis requests", 429);
  const body = (await c.req.json().catch(() => ({}))) as {
    requirements?: unknown;
    evidenceRequirement?: unknown;
  };
  const requirements = Array.isArray(body.requirements)
    ? body.requirements.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean)
    : [];
  if (requirements.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION, "requirements are required", 400);
  }
  const evidenceRequirement = body.evidenceRequirement === "strict" ? "strict" : "normal";
  const service = createRestaurantService(c.env, c.get("db"));
  const restaurant = await service.getDetails(c.req.param("restaurantId"));
  const analyzer = createDietaryAnalyzer(c.env, c.get("db"));
  const assessments = await analyzer.analyze(restaurant, {
    requirements,
    evidenceRequirement,
    depth: "deep"
  });
  return c.json({ assessments });
});

restaurantRoutes.get("/:restaurantId", async (c) => {
  requireUser(c);
  const service = createRestaurantService(c.env, c.get("db"));
  const restaurant = await service.getDetails(c.req.param("restaurantId"));
  return c.json({ restaurant: restaurantToCandidate(restaurant, undefined, { details: true }) });
});
