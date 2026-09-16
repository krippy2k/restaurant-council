import { Hono } from "hono";
import { AppError, ErrorCodes } from "@rc/shared";
import { clampRadiusMeters, milesToMeters } from "@rc/tools";
import type { EventSearchArea } from "@rc/domain";
import type { Env } from "../env.ts";
import { createLocationResolver } from "../restaurants.ts";
import { requireUser, type AppVariables } from "./session.ts";

export const locationRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

locationRoutes.post("/suggest", async (c) => {
  const identity = requireUser(c);
  const allowed = await c.get("db").consumeRateLimit(`loc-suggest:${identity.userId}`, 40, 60 * 60 * 1000);
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many location lookups", 429);
  const body = await c.req.json<{ query?: string }>();
  const query = body.query?.trim() ?? "";
  const suggestions = await createLocationResolver(c.env).suggest(query);
  return c.json({ suggestions });
});

locationRoutes.post("/resolve", async (c) => {
  const identity = requireUser(c);
  const allowed = await c.get("db").consumeRateLimit(`loc-resolve:${identity.userId}`, 40, 60 * 60 * 1000);
  if (!allowed) throw new AppError(ErrorCodes.RATE_LIMITED, "Too many location lookups", 429);
  const body = await c.req.json<{ query?: string; placeId?: string; radiusMiles?: number }>();
  const query = body.query?.trim();
  if (!query) {
    throw new AppError(ErrorCodes.VALIDATION, "Location query is required", 400);
  }
  const resolved = await createLocationResolver(c.env).resolve(query, body.placeId);
  const radiusMeters = clampRadiusMeters(
    body.radiusMiles != null ? milesToMeters(body.radiusMiles) : undefined
  );
  const searchArea: EventSearchArea = {
    ...resolved,
    radiusMeters
  };
  return c.json({ location: resolved, searchArea });
});
