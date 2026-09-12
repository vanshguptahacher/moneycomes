import { describe, it, expect, vi } from "vitest";
import { Hono, type Context } from "hono";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { config } from "../../server/config/index.js";
import { requireAuth, getAuthUser, getAuthSession } from "../../server/middleware/auth.js";
import { app } from "../../server/app.js";

describe("Authentication Foundation (Phase 1.3)", () => {
  describe("Better Auth Configuration & Security", () => {
    it("initializes auth instance successfully", () => {
      expect(auth).toBeDefined();
      expect(typeof auth.handler).toBe("function");
      expect(typeof auth.api.getSession).toBe("function");
    });

    it("enforces a strong secret with minimum 32 characters", () => {
      expect(config.BETTER_AUTH_SECRET).toBeDefined();
      expect(config.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it("configures secure baseURL and trusted origins", () => {
      expect(config.BETTER_AUTH_URL).toBe("http://localhost:3000");
      expect(config.TRUSTED_ORIGINS).toBeDefined();
      const origins = config.TRUSTED_ORIGINS.split(",").map((o) => o.trim());
      expect(origins).toContain("http://localhost:3000");
    });
  });

  describe("Authentication Middleware (requireAuth)", () => {
    it("rejects unauthenticated requests with HTTP 401 Unauthorized", async () => {
      const testApp = new Hono();
      testApp.get("/protected", requireAuth(), (c) => c.json({ status: "ok" }));

      const res = await testApp.request("/protected");
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("NEVER trusts client-supplied user ID in headers as proof of identity", async () => {
      const testApp = new Hono();
      testApp.get("/protected", requireAuth(), (c) => c.json({ status: "ok" }));

      // Attempting to spoof identity via headers
      const res = await testApp.request("/protected", {
        headers: {
          "x-user-id": "attacker-chosen-user-id",
          "user-id": "admin-123",
          Authorization: "Bearer invalid-token",
        },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("NEVER trusts client-supplied user ID in query params", async () => {
      const testApp = new Hono();
      testApp.get("/protected", requireAuth(), (c) => c.json({ status: "ok" }));

      const res = await testApp.request("/protected?userId=attacker-chosen-user-id");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("passes through and injects verified user/session when session is valid", async () => {
      const mockUser = {
        id: "usr_verified_123",
        name: "Test User",
        email: "test@example.com",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        defaultCurrencyCode: "INR",
      };

      const mockSession = {
        id: "sess_verified_456",
        userId: "usr_verified_123",
        token: "tok_test_token_xyz",
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock Better Auth session resolver
      const getSessionSpy = vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUser as unknown as AuthUser,
        session: mockSession as unknown as AuthSession,
      });

      const testApp = new Hono();
      testApp.get("/protected", requireAuth(), (c) => {
        const user = getAuthUser(c);
        const session = getAuthSession(c);
        return c.json({ user, session });
      });

      const res = await testApp.request("/protected", {
        headers: {
          Cookie: "better-auth.session_token=valid_token",
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.id).toBe("usr_verified_123");
      expect(body.user.email).toBe("test@example.com");
      expect(body.session.id).toBe("sess_verified_456");

      getSessionSpy.mockRestore();
    });

    it("rejects when Better Auth session is expired or invalid", async () => {
      const getSessionSpy = vi
        .spyOn(auth.api, "getSession")
        .mockResolvedValueOnce(null as unknown as { user: AuthUser; session: AuthSession });

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

  describe("Protected API Routes (/api/v1/auth/me)", () => {
    it("returns HTTP 401 for unauthenticated request to /api/v1/auth/me", async () => {
      const res = await app.request("/api/v1/auth/me");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("resolves verified user profile on /api/v1/auth/me when authenticated", async () => {
      const mockUser = {
        id: "usr_alice_789",
        name: "Alice Wonderland",
        email: "alice@example.com",
        emailVerified: false,
        image: "https://example.com/avatar.png",
        createdAt: new Date(),
        updatedAt: new Date(),
        defaultCurrencyCode: "INR",
      };

      const mockSession = {
        id: "sess_alice_999",
        userId: "usr_alice_789",
        token: "tok_alice_token",
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const getSessionSpy = vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUser as unknown as AuthUser,
        session: mockSession as unknown as AuthSession,
      });

      const res = await app.request("/api/v1/auth/me", {
        headers: {
          Cookie: "better-auth.session_token=alice_session",
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.id).toBe("usr_alice_789");
      expect(body.user.email).toBe("alice@example.com");
      expect(body.user.name).toBe("Alice Wonderland");
      expect(body.session.id).toBe("sess_alice_999");

      getSessionSpy.mockRestore();
    });
  });

  describe("Better Auth Handler Route Mounting", () => {
    it("handles Better Auth router requests under /api/auth/**", async () => {
      // Better Auth responds to /api/auth/ok with 200 OK and { ok: true }
      const res = await app.request("/api/auth/ok");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("handles session retrieval query via Better Auth router", async () => {
      const res = await app.request("/api/auth/get-session");
      // Without session cookies, get-session returns null or empty session with 200 OK
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBeNull();
    });
  });

  describe("Auth Context Helper Safety", () => {
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
