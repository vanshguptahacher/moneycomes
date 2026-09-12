import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import {
  AppError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from "../../server/errors/index.js";
import { errorHandler } from "../../server/middleware/error-handler.js";
import { requestId } from "../../server/middleware/request-id.js";
import { validateJson, getValidJson } from "../../server/middleware/validator.js";
import { sendSuccess } from "../../server/utils/response.js";
import { UserService } from "../../server/services/user.service.js";
import type { UserRepository } from "../../server/repositories/user.repository.js";
import type { User } from "../../server/db/schema/index.js";

describe("Backend Service & Repository Architecture (Phase 1.5)", () => {
  describe("Domain Error Model & Centralized Error Handler Mapping", () => {
    it("maps NotFoundError to HTTP 404 with standard error envelope", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/test", () => {
        throw new NotFoundError("Profile 123 does not exist");
      });
      testApp.onError(errorHandler);

      const res = await testApp.request("/test");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toBe("Profile 123 does not exist");
      expect(body.error.requestId).toBeDefined();
    });

    it("maps ForbiddenError to HTTP 403 with standard error envelope", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/test", () => {
        throw new ForbiddenError("You cannot view this resource");
      });
      testApp.onError(errorHandler);

      const res = await testApp.request("/test");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toBe("You cannot view this resource");
      expect(body.error.requestId).toBeDefined();
    });

    it("maps ConflictError to HTTP 409 with standard error envelope", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/test", () => {
        throw new ConflictError("Email already in use");
      });
      testApp.onError(errorHandler);

      const res = await testApp.request("/test");
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.message).toBe("Email already in use");
    });

    it("maps ValidationError to HTTP 400 with standard error envelope", async () => {
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.get("/test", () => {
        throw new ValidationError("Invalid domain payload", { field: ["error"] });
      });
      testApp.onError(errorHandler);

      const res = await testApp.request("/test");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details).toEqual({ field: ["error"] });
    });

    it("AppError hierarchy inherits from standard Error and maintains custom codes", () => {
      const err = new NotFoundError("Missing item");
      expect(err instanceof Error).toBe(true);
      expect(err instanceof AppError).toBe(true);
      expect(err.code).toBe("NOT_FOUND");
    });
  });

  describe("Service Layer Isolation & Authorization Rules", () => {
    const mockUser: User = {
      id: "usr_alice",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: true,
      image: null,
      defaultCurrencyCode: "INR",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("allows authorized actor to retrieve their own user profile", async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue(mockUser),
        findByEmail: vi.fn(),
        update: vi.fn(),
      } as unknown as UserRepository;

      const service = new UserService(mockRepo);
      const result = await service.getUserById("usr_alice", "usr_alice");

      expect(result.id).toBe("usr_alice");
      expect(result.email).toBe("alice@example.com");
      expect(mockRepo.findById).toHaveBeenCalledWith("usr_alice");
    });

    it("throws ForbiddenError when actor attempts to access an unauthorized profile", async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue(mockUser),
        findByEmail: vi.fn(),
        update: vi.fn(),
      } as unknown as UserRepository;

      const service = new UserService(mockRepo);
      await expect(service.getUserById("usr_bob", "usr_alice")).rejects.toThrow(
        ForbiddenError
      );
      // Repository should NOT be queried if authorization fails early or is forbidden
    });

    it("throws NotFoundError when user does not exist", async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue(null),
        findByEmail: vi.fn(),
        update: vi.fn(),
      } as unknown as UserRepository;

      const service = new UserService(mockRepo);
      await expect(service.getUserById("usr_unknown", "usr_unknown")).rejects.toThrow(
        NotFoundError
      );
    });

    it("throws ForbiddenError if actor attempts to update another user's profile", async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue(mockUser),
        findByEmail: vi.fn(),
        update: vi.fn(),
      } as unknown as UserRepository;

      const service = new UserService(mockRepo);
      await expect(
        service.updateProfile("usr_attacker", "usr_victim", { name: "Hacked" })
      ).rejects.toThrow(ForbiddenError);

      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });

  describe("End-to-End Layering Pipeline (HTTP -> Validation -> Service -> Repo -> Response)", () => {
    const updateSchema = z.object({
      name: z.string().min(2).max(50),
    });

    it("executes valid end-to-end request through all architectural layers cleanly", async () => {
      const mockUser: User = {
        id: "usr_carol",
        name: "Carol Initial",
        email: "carol@example.com",
        emailVerified: true,
        image: null,
        defaultCurrencyCode: "INR",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedUser: User = {
        ...mockUser,
        name: "Carol Updated",
      };

      const mockRepo = {
        findById: vi.fn().mockResolvedValue(mockUser),
        findByEmail: vi.fn(),
        update: vi.fn().mockResolvedValue(updatedUser),
      } as unknown as UserRepository;

      const service = new UserService(mockRepo);

      // Construct isolated test route using architectural pipeline
      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.onError(errorHandler);

      // Simulate authenticated route: actor is 'usr_carol'
      testApp.patch("/profile", validateJson(updateSchema), async (c) => {
        const actorId = "usr_carol"; // from verified session in real app
        const body = getValidJson<typeof updateSchema>(c);
        const result = await service.updateProfile(actorId, actorId, body);
        return sendSuccess(c, result, 200);
      });

      const res = await testApp.request("/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Carol Updated" }),
      });

      expect(res.status).toBe(200);
      const responseBody = await res.json();
      expect(responseBody.data.name).toBe("Carol Updated");
      expect(responseBody.meta.requestId).toBeDefined();
      expect(mockRepo.update).toHaveBeenCalledWith("usr_carol", { name: "Carol Updated" });
    });

    it("halts at validation layer if request body is invalid, never invoking service or repo", async () => {
      const mockRepo = {
        findById: vi.fn(),
        findByEmail: vi.fn(),
        update: vi.fn(),
      } as unknown as UserRepository;

      const service = new UserService(mockRepo);

      const testApp = new Hono();
      testApp.use("*", requestId());
      testApp.onError(errorHandler);

      testApp.patch("/profile", validateJson(updateSchema), async (c) => {
        const body = getValidJson<typeof updateSchema>(c);
        const result = await service.updateProfile("usr_carol", "usr_carol", body);
        return sendSuccess(c, result);
      });

      // Name too short (violates min(2))
      const res = await testApp.request("/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "a" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });
});
