import { Hono } from "hono";
import { cors } from "hono/cors";
import { isAppError } from "@rc/shared";
import type { Env } from "./env.ts";
import { CouncilDurableObject } from "./council-do.ts";
import { authRoutes } from "./http/auth-routes.ts";
import { collaborationRoutes } from "./http/collaboration-routes.ts";
import { councilRoutes } from "./http/council-routes.ts";
import { eventIntentRoutes } from "./http/event-intent-routes.ts";
import { eventRoutes } from "./http/event-routes.ts";
import { inviteRoutes } from "./http/invite-routes.ts";
import { locationRoutes } from "./http/location-routes.ts";
import { restaurantRoutes } from "./http/restaurant-routes.ts";
import { sessionMiddleware, type AppVariables } from "./http/session.ts";
import { restaurantProviderName, dietaryAnalyzerName } from "./restaurants.ts";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use(
  "*",
  cors({
    origin: (origin, c) => origin === c.env.APP_ORIGIN ? origin : c.env.APP_ORIGIN,
    credentials: true
  })
);

app.use("*", sessionMiddleware);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "restaurant-council",
    agents: c.env.OPENAI_API_KEY ? "llm" : "deterministic",
    restaurants: restaurantProviderName(c.env),
    dietary: dietaryAnalyzerName(c.env)
  })
);
app.route("/api/auth", authRoutes);
app.route("/api/events", collaborationRoutes);
app.route("/api/events", eventIntentRoutes);
app.route("/api/events", eventRoutes);
app.route("/api/events", councilRoutes);
app.route("/api/invites", inviteRoutes);
app.route("/api/locations", locationRoutes);
app.route("/api/restaurants", restaurantRoutes);

app.notFound((c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404)
);

app.onError((error, c) => {
  if (isAppError(error)) {
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status as never
    );
  }
  console.error(error);
  return c.json({ error: { code: "INTERNAL", message: "Internal error" } }, 500);
});

export { CouncilDurableObject };
export default app;
