import type { Context, MiddlewareHandler } from "hono";
import { auth, type AuthSession, type AuthUser } from "../auth/index.js";
import { sendError } from "../utils/response.js";

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
    session: AuthSession;
  }
}

/**
 * Authentication middleware that validates incoming sessions via Better Auth.
 *
 * Rules:
 * 1. Session is strictly verified using HTTP request headers/cookies.
 * 2. Client-supplied user IDs in headers, query params, or body are NEVER trusted.
 * 3. Rejects missing, invalid, or expired sessions with HTTP 401 Unauthorized.
 */
export const requireAuth: () => MiddlewareHandler = () => {
  return async (c, next) => {
    if (c.get("user") && c.get("session")) {
      return await next();
    }

    try {
      const sessionResult = await auth.api.getSession({
        headers: c.req.raw.headers,
      });

      if (!sessionResult || !sessionResult.session || !sessionResult.user) {
        return sendError(
          c,
          "UNAUTHORIZED",
          "Authentication required. Please sign in to continue.",
          401
        );
      }

      c.set("user", sessionResult.user);
      c.set("session", sessionResult.session);

      await next();
    } catch (err) {
      console.warn("Session verification error:", (err as Error).message);
      return sendError(
        c,
        "UNAUTHORIZED",
        "Invalid or expired session. Please sign in again.",
        401
      );
    }
  };
};

/**
 * Retrieve the verified authenticated user from Hono context.
 * Throws if the route was not protected by requireAuth.
 */
export function getAuthUser(c: Context): AuthUser {
  const user = c.get("user");
  if (!user) {
    throw new Error("getAuthUser called on an unauthenticated request context");
  }
  return user;
}

/**
 * Retrieve the verified session from Hono context.
 * Throws if the route was not protected by requireAuth.
 */
export function getAuthSession(c: Context): AuthSession {
  const session = c.get("session");
  if (!session) {
    throw new Error("getAuthSession called on an unauthenticated request context");
  }
  return session;
}
