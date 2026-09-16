import { Hono } from "hono";
import { AppError, ErrorCodes } from "@rc/shared";
import type { Env } from "../env.ts";
import {
  clearSession,
  issueSession,
  requireUser,
  type AppVariables
} from "./session.ts";

export const authRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

authRoutes.post("/dev-signin", async (c) => {
  const body = await c.req.json<{ email?: string; displayName?: string }>();
  const email = body.email?.trim().toLowerCase();
  const displayName = body.displayName?.trim();
  if (!email || !email.includes("@")) {
    throw new AppError(ErrorCodes.VALIDATION, "A valid email is required", 400);
  }
  const db = c.get("db");
  let user = await db.getUserByEmail(email);
  const created = !user;
  if (!user) {
    user = await db.createUser({ email, displayName: displayName || email.split("@")[0] });
  }
  await issueSession(c, user.id);
  await db.insertAudit({
    actorType: "user",
    actorId: user.id,
    action: "USER_AUTHENTICATED",
    decision: "ALLOW"
  });
  return c.json({ user, created });
});

authRoutes.post("/signout", async (c) => {
  await clearSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const identity = requireUser(c);
  const user = await c.get("db").getUser(identity.userId);
  return c.json({ user });
});
