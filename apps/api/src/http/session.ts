import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { createUserPrincipal, type Identity, type Principal } from "@rc/auth";
import { addHours, AppError, ErrorCodes, hashToken, nowIso } from "@rc/shared";
import { Database } from "../db/database.ts";
import type { Env } from "../env.ts";

export type AppVariables = {
  db: Database;
  identity: Identity | null;
  principal: Principal | null;
};

export type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

const COOKIE = "rc_session";

export async function sessionMiddleware(c: AppContext, next: Next): Promise<void> {
  const db = new Database(c.env.DB);
  c.set("db", db);
  const token = getCookie(c, COOKIE);
  if (!token) {
    c.set("identity", null);
    c.set("principal", null);
    await next();
    return;
  }
  const user = await db.getSessionUser(await hashToken(token));
  if (!user) {
    c.set("identity", null);
    c.set("principal", null);
    await next();
    return;
  }
  const identity: Identity = {
    userId: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName
  };
  c.set("identity", identity);
  c.set("principal", createUserPrincipal(user.id));
  await next();
}

export function requireUser(c: AppContext): Identity {
  const identity = c.get("identity");
  if (!identity) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, "Sign in required", 401);
  }
  return identity;
}

export async function issueSession(c: AppContext, userId: string): Promise<void> {
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const tokenHash = await hashToken(token);
  const expiresAt = addHours(nowIso(), 24 * 14);
  await c.get("db").createSession(userId, tokenHash, expiresAt);
  const secure = c.env.ENVIRONMENT === "production";
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure,
    maxAge: 60 * 60 * 24 * 14
  });
}

export async function clearSession(c: AppContext): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) {
    await c.get("db").deleteSession(await hashToken(token));
  }
  deleteCookie(c, COOKIE, { path: "/" });
}
