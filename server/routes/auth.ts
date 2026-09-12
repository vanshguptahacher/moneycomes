import { Hono } from "hono";
import { getAuthSession, getAuthUser, requireAuth } from "../middleware/auth.js";

export const authRoutes = new Hono();

/**
 * Protected user endpoint to verify session resolution.
 * Requires a valid Better Auth session.
 */
authRoutes.get("/me", requireAuth(), (c) => {
  const user = getAuthUser(c);
  const session = getAuthSession(c);

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: user.createdAt,
    },
    session: {
      id: session.id,
      expiresAt: session.expiresAt,
    },
  });
});
