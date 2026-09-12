/**
 * Phase 4.1 — Authentication Foundation / Better Auth Backend Integration Test Suite.
 *
 * Verifies that:
 * 1. Better Auth is initialized and configured with Drizzle adapter and PostgreSQL provider.
 * 2. Auth schema mappings correctly point to canonical users, sessions, accounts, verifications tables.
 * 3. Hono API correctly mounts Better Auth routes under /api/auth/* with standard Web Request handling.
 * 4. Authentication middleware (requireAuth) rejects unauthenticated, invalid, or spoofed requests.
 * 5. Zero trust of client user IDs is strictly enforced (headers, query params, body are ignored).
 * 6. Protected endpoint /api/v1/auth/me returns safe profile representation without secrets or hashes.
 * 7. Cloudflare Workers compatibility is maintained (Web standard crypto, Request/Response).
 */

import { describe, it, expect, vi } from "vitest";
import { Hono, type Context } from "hono";
import { getTableColumns } from "drizzle-orm";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { config, validateConfig, ConfigurationError } from "../../server/config/index.js";
import { requireAuth, getAuthUser, getAuthSession } from "../../server/middleware/auth.js";
import { app } from "../../server/app.js";
import {
  users,
  sessions,
  accounts,
  verifications,
} from "../../server/db/schema/index.js";

describe("Phase 4.1 — Authentication Foundation (Better Auth Integration)", () => {
  // ==========================================================================
  // 1. BETTER AUTH CONFIGURATION & INVARIANTS
  // ==========================================================================
  describe("Better Auth Configuration & Runtime Invariants", () => {
    it("successfully initializes Better Auth instance with handler and api methods", () => {
      expect(auth).toBeDefined();
      expect(typeof auth.handler).toBe("function");
      expect(typeof auth.api.getSession).toBe("function");
      expect(typeof auth.api.signInEmail).toBe("function");
      expect(typeof auth.api.signUpEmail).toBe("function");
      expect(typeof auth.api.signOut).toBe("function");
    });

    it("enforces a strong secret with at least 32 characters", () => {
      expect(config.BETTER_AUTH_SECRET).toBeDefined();
      expect(typeof config.BETTER_AUTH_SECRET).toBe("string");
      expect(config.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it("fails fast in production mode if placeholder secrets are detected", () => {
      expect(() => {
        validateConfig({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://user:pass@remote-db.supabase.co:5432/moneycomes",
          BETTER_AUTH_SECRET: "your_development_secret_here_minimum_32_characters",
          BETTER_AUTH_URL: "https://api.moneycomes.app",
          CORS_ORIGIN: "https://moneycomes.app",
        });
      }).toThrow(ConfigurationError);
    });

    it("configures canonical baseURL and trusted origins", () => {
      expect(config.BETTER_AUTH_URL).toBeDefined();
      expect(config.BETTER_AUTH_URL.startsWith("http")).toBe(true);

      const origins = config.TRUSTED_ORIGINS.split(",").map((o) => o.trim());
      expect(origins.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // 2. DATABASE SCHEMA INTEGRATION & COLUMN MAPPINGS
  // ==========================================================================
  describe("Database Schema Integration & Drizzle Adapter Mapping", () => {
    it("maps authoritative users table with required Better Auth columns", () => {
      const cols = getTableColumns(users);
      expect(cols.id).toBeDefined();
      expect(cols.id.dataType).toBe("string");
      expect(cols.id.primary).toBe(true);
      expect(cols.name).toBeDefined();
      expect(cols.email).toBeDefined();
      expect(cols.email.isUnique).toBe(true);
      expect(cols.emailVerified).toBeDefined();
      expect(cols.image).toBeDefined();
      expect(cols.defaultCurrencyCode).toBeDefined();
      expect(cols.createdAt).toBeDefined();
      expect(cols.updatedAt).toBeDefined();
    });

    it("maps sessions table with required Better Auth fields and token uniqueness", () => {
      const cols = getTableColumns(sessions);
      expect(cols.id).toBeDefined();
      expect(cols.id.dataType).toBe("string");
      expect(cols.id.primary).toBe(true);
      expect(cols.token).toBeDefined();
      expect(cols.token.isUnique).toBe(true);
      expect(cols.userId).toBeDefined();
      expect(cols.expiresAt).toBeDefined();
      expect(cols.createdAt).toBeDefined();
      expect(cols.updatedAt).toBeDefined();
    });

    it("maps accounts table segregating passwords and OAuth tokens from users table", () => {
      const userCols = getTableColumns(users) as Record<string, unknown>;
      expect(userCols["password"]).toBeUndefined();
      expect(userCols["passwordHash"]).toBeUndefined();

      const accountCols = getTableColumns(accounts);
      expect(accountCols.id).toBeDefined();
      expect(accountCols.accountId).toBeDefined();
      expect(accountCols.providerId).toBeDefined();
      expect(accountCols.userId).toBeDefined();
      expect(accountCols.password).toBeDefined();
    });

    it("maps verifications table for email/token verification tracking", () => {
      const cols = getTableColumns(verifications);
      expect(cols.id).toBeDefined();
      expect(cols.identifier).toBeDefined();
      expect(cols.value).toBeDefined();
      expect(cols.expiresAt).toBeDefined();
    });
  });

  // ==========================================================================
  // 3. HONO ROUTE MOUNTING (/api/auth/*)
  // ==========================================================================
  describe("Hono Better Auth Route Mounting", () => {
    it("serves Better Auth router requests under /api/auth/ok with 200 OK", async () => {
      const res = await app.request("/api/auth/ok");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("returns null session for unauthenticated get-session query via /api/auth/get-session", async () => {
      const res = await app.request("/api/auth/get-session");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBeNull();
    });

    it("handles CORS preflight OPTIONS request on /api/auth/get-session with credentials", async () => {
      const res = await app.request("/api/auth/get-session", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "GET",
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    });
  });

  // ==========================================================================
  // 4. AUTHENTICATION MIDDLEWARE & ZERO TRUST SPOOFING PROTECTION
  // ==========================================================================
  describe("Authentication Middleware (requireAuth) & Zero Trust Identity", () => {
    it("rejects unauthenticated requests with HTTP 401 and structured error envelope", async () => {
      const testApp = new Hono();
      testApp.get("/protected", requireAuth(), (c) => c.json({ status: "ok" }));

      const res = await testApp.request("/protected");
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toContain("Authentication required");
      expect(body.error.requestId).toBeDefined();
    });

    it("rejects spoofed X-User-Id header as proof of identity", async () => {
      const testApp = new Hono();
      testApp.get("/protected", requireAuth(), (c) => c.json({ status: "ok" }));

      const res = await testApp.request("/protected", {
        headers: {
          "x-user-id": "attacker-chosen-user-id",
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects spoofed User-Id header as proof of identity", async () => {
      const testApp = new Hono();
      testApp.get("/protected", requireAuth(), (c) => c.json({ status: "ok" }));

      const res = await testApp.request("/protected", {
        headers: {
          "user-id": "admin-account-999",
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects spoofed userId in URL query parameters", async () => {
      const testApp = new Hono();
      testApp.get("/protected", requireAuth(), (c) => c.json({ status: "ok" }));

      const res = await testApp.request("/protected?userId=attacker-admin");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("passes verified session and injects user context when session is authentic", async () => {
      const mockUser = {
        id: "usr_phase4_verified",
        name: "Verified Tester",
        email: "tester@example.com",
        emailVerified: true,
        image: null,
        defaultCurrencyCode: "INR",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockSession = {
        id: "sess_phase4_token",
        userId: "usr_phase4_verified",
        token: "tok_secure_random_abc",
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const getSessionSpy = vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUser as unknown as AuthUser,
        session: mockSession as unknown as AuthSession,
      });

      const testApp = new Hono();
      testApp.get("/protected", requireAuth(), (c) => {
        const user = getAuthUser(c);
        const session = getAuthSession(c);
        return c.json({ userId: user.id, sessionId: session.id });
      });

      const res = await testApp.request("/protected", {
        headers: {
          Cookie: "better-auth.session_token=valid_session_token",
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe("usr_phase4_verified");
      expect(body.sessionId).toBe("sess_phase4_token");

      getSessionSpy.mockRestore();
    });

    it("rejects expired or null session returned by session validator", async () => {
      const getSessionSpy = vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as unknown as { user: AuthUser; session: AuthSession });

      const testApp = new Hono();
      testApp.get("/protected", requireAuth(), (c) => c.json({ status: "ok" }));

      const res = await testApp.request("/protected", {
        headers: {
          Cookie: "better-auth.session_token=expired_token",
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");

      getSessionSpy.mockRestore();
    });
  });

  // ==========================================================================
  // 5. PROTECTED API ENDPOINT & SECRET SEGREGATION (/api/v1/auth/me)
  // ==========================================================================
  describe("Protected Test Endpoint & Secret Segregation (/api/v1/auth/me)", () => {
    it("returns HTTP 401 when accessing /api/v1/auth/me unauthenticated", async () => {
      const res = await app.request("/api/v1/auth/me");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("returns safe user representation without passwords or auth secrets", async () => {
      const mockUser = {
        id: "usr_alice_safe",
        name: "Alice Wonderland",
        email: "alice@example.com",
        emailVerified: true,
        image: "https://example.com/avatar.png",
        defaultCurrencyCode: "INR",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      };

      const mockSession = {
        id: "sess_alice_safe",
        userId: "usr_alice_safe",
        token: "secret_session_token_should_not_leak",
        expiresAt: new Date("2026-01-08T00:00:00Z"),
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      };

      const getSessionSpy = vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUser as unknown as AuthUser,
        session: mockSession as unknown as AuthSession,
      });

      const res = await app.request("/api/v1/auth/me", {
        headers: {
          Cookie: "better-auth.session_token=alice_valid_token",
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.user).toBeDefined();
      expect(body.user.id).toBe("usr_alice_safe");
      expect(body.user.name).toBe("Alice Wonderland");
      expect(body.user.email).toBe("alice@example.com");
      expect(body.user.emailVerified).toBe(true);

      // Secret segregation checks:
      const rawUser = body.user as Record<string, unknown>;
      expect(rawUser["password"]).toBeUndefined();
      expect(rawUser["passwordHash"]).toBeUndefined();
      expect(rawUser["accessToken"]).toBeUndefined();
      expect(rawUser["secret"]).toBeUndefined();

      const rawSession = body.session as Record<string, unknown>;
      expect(rawSession["token"]).toBeUndefined(); // raw session token omitted from safe me endpoint

      getSessionSpy.mockRestore();
    });
  });

  // ==========================================================================
  // 6. CLOUDFLARE WORKERS COMPATIBILITY & CONTEXT SAFETY
  // ==========================================================================
  describe("Cloudflare Workers Compatibility & Context Safety", () => {
    it("executes cleanly via app.fetch using Web Standard Request", async () => {
      const request = new Request("http://localhost/health", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      const response = await app.fetch(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.status).toBe("ok");
      expect(typeof json.uptimeSeconds).toBe("number");
    });

    it("getAuthUser throws descriptive error if accessed on unauthenticated context", () => {
      const mockContext = {
        get: vi.fn().mockReturnValue(undefined),
      } as unknown as Context;

      expect(() => getAuthUser(mockContext)).toThrow(
        "getAuthUser called on an unauthenticated request context"
      );
    });

    it("getAuthSession throws descriptive error if accessed on unauthenticated context", () => {
      const mockContext = {
        get: vi.fn().mockReturnValue(undefined),
      } as unknown as Context;

      expect(() => getAuthSession(mockContext)).toThrow(
        "getAuthSession called on an unauthenticated request context"
      );
    });
  });
});
