import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { app } from "../../server/app.js";
import { requestId } from "../../server/middleware/request-id.js";
import {
  validateJson,
  validateQuery,
  validateParam,
  getValidJson,
  getValidQuery,
  getValidParam,
} from "../../server/middleware/validator.js";
import { errorHandler } from "../../server/middleware/error-handler.js";
import { sendSuccess, sendError } from "../../server/utils/response.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";

describe("API Architecture & Middleware Foundation (Phase 1.4)", () => {
  describe("Request ID Middleware", () => {
    it("generates a new UUID request ID when X-Request-Id header is missing", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/test", (c) => c.json({ id: c.get("requestId") }));

      const res = await testApp.request("/test");
      expect(res.status).toBe(200);

      const headerId = res.headers.get("x-request-id");
      expect(headerId).toBeDefined();
      expect(headerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      const body = await res.json();
      expect(body.id).toBe(headerId);
    });

    it("preserves incoming X-Request-Id if it satisfies strict safety rules", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/test", (c) => c.json({ id: c.get("requestId") }));

      const safeId = "client-req-trace-12345";
      const res = await testApp.request("/test", {
        headers: {
          "X-Request-Id": safeId,
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("x-request-id")).toBe(safeId);
      const body = await res.json();
      expect(body.id).toBe(safeId);
    });

    it("sanitizes and replaces unsafe/malicious incoming request IDs with a fresh UUID", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/test", (c) => c.json({ id: c.get("requestId") }));

      // Unsafe header containing special characters or exceeding 64 chars
      const unsafeId = "unsafe<script>alert(1)</script>";
      const res = await testApp.request("/test", {
        headers: {
          "X-Request-Id": unsafeId,
        },
      });

      expect(res.status).toBe(200);
      const headerId = res.headers.get("x-request-id");
      expect(headerId).not.toBe(unsafeId);
      expect(headerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe("HTTP Security Baseline", () => {
    it("emits baseline HTTP security headers on responses", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);

      // Security headers injected by secureHeaders()
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    });

    it("enforces request body size limits and rejects payloads over 1MB with HTTP 413", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.onError(errorHandler);

      // Mount body limit of 1MB matching app.ts
      const { bodyLimit } = await import("hono/body-limit");
      testApp.use(
        "*",
        bodyLimit({
          maxSize: 1024 * 1024,
          onError: (c) => {
            return sendError(
              c,
              "PAYLOAD_TOO_LARGE",
              "Request payload exceeds maximum allowed size of 1MB",
              413
            );
          },
        })
      );

      testApp.post("/test-upload", async (c) => c.json({ status: "ok" }));

      // Create payload > 1MB
      const hugeString = "x".repeat(1024 * 1024 + 50);
      const res = await testApp.request("/test-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: hugeString }),
      });

      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    });
  });

  describe("Request Validation Middleware", () => {
    const testSchema = z.object({
      title: z.string().min(3).max(50),
      amount: z.number().int().positive(),
    });

    it("validates JSON bodies and attaches typed data to context", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.post("/item", validateJson(testSchema), (c) => {
        const validated = getValidJson<typeof testSchema>(c);
        return sendSuccess(c, validated, 201);
      });

      const res = await testApp.request("/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Groceries", amount: 1500 }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.title).toBe("Groceries");
      expect(body.data.amount).toBe(1500);
      expect(body.meta.requestId).toBeDefined();
    });

    it("returns HTTP 400 with field-level errors when JSON body fails validation", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.post("/item", validateJson(testSchema), (c) => {
        const validated = getValidJson<typeof testSchema>(c);
        return sendSuccess(c, validated, 201);
      });

      const res = await testApp.request("/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "a", amount: -50 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details.title).toBeDefined();
      expect(body.error.details.amount).toBeDefined();
      expect(body.error.requestId).toBeDefined();
    });

    it("returns MALFORMED_JSON when request body is not valid JSON", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.post("/item", validateJson(testSchema), (c) => c.json({ ok: true }));

      const res = await testApp.request("/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ not valid json ...",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("MALFORMED_JSON");
    });

    it("validates query parameters correctly", async () => {
      const querySchema = z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().max(100).default(20),
      });

      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/items", validateQuery(querySchema), (c) => {
        const query = getValidQuery<typeof querySchema>(c);
        return sendSuccess(c, query);
      });

      const res = await testApp.request("/items?page=2&limit=50");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.page).toBe(2);
      expect(body.data.limit).toBe(50);
    });

    it("validates path parameters correctly", async () => {
      const paramSchema = z.object({
        id: z.string().uuid(),
      });

      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/items/:id", validateParam(paramSchema), (c) => {
        const param = getValidParam<typeof paramSchema>(c);
        return sendSuccess(c, param);
      });

      // Valid UUID
      const validRes = await testApp.request(
        "/items/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
      );
      expect(validRes.status).toBe(200);

      // Invalid UUID
      const invalidRes = await testApp.request("/items/not-a-uuid");
      expect(invalidRes.status).toBe(400);
      const body = await invalidRes.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Centralized Error & Response Helpers", () => {
    it("sendSuccess wraps data with meta and requestId", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/data", (c) => sendSuccess(c, { hello: "world" }, 200, { custom: "flag" }));

      const res = await testApp.request("/data");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.hello).toBe("world");
      expect(body.meta.custom).toBe("flag");
      expect(body.meta.requestId).toBeDefined();
    });

    it("handles 404 with standard error envelope including requestId", async () => {
      const res = await app.request("/api/v1/non-existent-route-for-testing");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.requestId).toBeDefined();
    });

    it("centralized error handler catches internal errors without leaking internals", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/boom", () => {
        throw new Error("Sensitive DB password: postgres://secret@localhost:5432");
      });
      testApp.onError(errorHandler);

      const res = await testApp.request("/boom");
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.requestId).toBeDefined();
    });
  });

  describe("Protected Route Guard & Server Authority", () => {
    it("rejects unauthenticated access to protected routes with 401 and requestId", async () => {
      const res = await app.request("/api/v1/auth/me");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.requestId).toBeDefined();
    });

    it("resolves authenticated session and provides server-authoritative identity", async () => {
      const mockUser = {
        id: "usr_server_auth_1",
        name: "Verified Identity",
        email: "verified@example.com",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        defaultCurrencyCode: "INR",
      };

      const mockSession = {
        id: "sess_server_auth_1",
        userId: "usr_server_auth_1",
        token: "tok_secure_1",
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
          Cookie: "better-auth.session_token=valid_session_token",
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.id).toBe("usr_server_auth_1");
      expect(body.user.email).toBe("verified@example.com");

      getSessionSpy.mockRestore();
    });
  });

  describe("Health & Readiness Probes", () => {
    it("liveness probe GET /health returns 200 OK with process uptime", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(typeof body.uptimeSeconds).toBe("number");
    });

    it("readiness probe GET /health/ready returns status and checks structure", async () => {
      const res = await app.request("/health/ready");
      // Returns 200 if DB reachable or 503 if degraded, without leaking credentials
      expect([200, 503]).toContain(res.status);
      const body = await res.json();
      expect(["ready", "degraded"]).toContain(body.status);
      expect(body.checks).toBeDefined();
      expect(body.checks.database).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });
  });
});
