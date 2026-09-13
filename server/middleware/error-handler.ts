import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { config } from "../config/index.js";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthorizedError,
} from "../errors/index.js";
import { sendError } from "../utils/response.js";
import { MoneyError } from "../../src/domain/index.js";

/**
 * Centralized API error handler.
 * - Guarantees consistent error JSON contracts.
 * - Automatically maps application AppError subclasses to HTTP status codes.
 * - Automatically maps financial MoneyError domain errors to HTTP 400 Bad Request.
 * - Emits requestId in every error payload.
 * - Logs server errors without exposing stack traces, DB connection strings, or SQL in production.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  const reqId = c.get("requestId") || "unknown";

  // Handle Financial Domain errors
  if (err instanceof MoneyError) {
    return sendError(c, err.code, err.message, 400);
  }

  // Handle Application domain errors (decoupled from HTTP)
  if (err instanceof AppError) {
    let status: ContentfulStatusCode = 400;
    if (err instanceof NotFoundError) {
      status = 404;
    } else if (err instanceof UnauthorizedError) {
      status = 401;
    } else if (err instanceof ForbiddenError) {
      status = 403;
    } else if (err instanceof ConflictError) {
      status = 409;
    } else if (err instanceof InternalError) {
      status = 500;
    }

    return sendError(c, err.code, err.message, status, err.details);
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return sendError(
      c,
      "VALIDATION_ERROR",
      "Request validation failed",
      400,
      err.flatten().fieldErrors
    );
  }

  // Handle Hono HTTPExceptions
  if (err instanceof HTTPException) {
    const code =
      err.status === 401
        ? "UNAUTHORIZED"
        : err.status === 403
          ? "FORBIDDEN"
          : err.status === 404
            ? "NOT_FOUND"
            : err.status === 413
              ? "PAYLOAD_TOO_LARGE"
              : `HTTP_${err.status}`;

    return sendError(c, code, err.message, err.status as ContentfulStatusCode);
  }

  // Log unexpected errors
  console.error(
    JSON.stringify({
      level: "error",
      requestId: reqId,
      message: err.message,
      stack: config.NODE_ENV === "development" ? err.stack : undefined,
      timestamp: new Date().toISOString(),
    })
  );

  // Return safe error response (no stack traces or internal DB details in production)
  const safeMessage =
    config.NODE_ENV === "development"
      ? err.message
      : "An unexpected internal server error occurred";

  return sendError(c, "INTERNAL_ERROR", safeMessage, 500);
};

/**
 * 404 Not Found handler for unmapped endpoints.
 */
export const notFoundHandler: NotFoundHandler = (c) => {
  return sendError(
    c,
    "NOT_FOUND",
    `Route not found: ${c.req.method} ${c.req.path}`,
    404
  );
};
