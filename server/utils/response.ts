import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Sends a standardized success JSON response.
 */
export function sendSuccess<T>(
  c: Context,
  data: T,
  status: ContentfulStatusCode = 200,
  meta?: Record<string, unknown>
) {
  const reqId = c.get("requestId") || "unknown";
  return c.json(
    {
      data,
      meta: {
        requestId: reqId,
        ...meta,
      },
    },
    status
  );
}

/**
 * Sends a standardized error JSON response.
 */
export function sendError(
  c: Context,
  code: string,
  message: string,
  status: ContentfulStatusCode = 400,
  details?: unknown
) {
  const reqId = c.get("requestId") || "unknown";
  const body: ApiErrorResponse = {
    error: {
      code,
      message,
      requestId: reqId,
      ...(details !== undefined ? { details } : {}),
    },
  };
  return c.json(body, status);
}
