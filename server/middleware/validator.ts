import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { ZodSchema, z } from "zod";
import { sendError } from "../utils/response.js";

/**
 * Validates incoming JSON request body against a Zod schema.
 */
export const validateJson = <T extends ZodSchema>(schema: T) =>
  createMiddleware(async (c, next) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return sendError(c, "MALFORMED_JSON", "Invalid or malformed JSON payload in request body", 400);
    }

    const result = schema.safeParse(rawBody);
    if (!result.success) {
      return sendError(
        c,
        "VALIDATION_ERROR",
        "Request body validation failed",
        400,
        result.error.flatten().fieldErrors
      );
    }

    c.set("validJson", result.data);
    await next();
  });

/**
 * Validates incoming query parameters against a Zod schema.
 */
export const validateQuery = <T extends ZodSchema>(schema: T) =>
  createMiddleware(async (c, next) => {
    const rawQuery = c.req.query();
    const result = schema.safeParse(rawQuery);
    if (!result.success) {
      return sendError(
        c,
        "VALIDATION_ERROR",
        "Query parameter validation failed",
        400,
        result.error.flatten().fieldErrors
      );
    }

    c.set("validQuery", result.data);
    await next();
  });

/**
 * Validates route path parameters against a Zod schema.
 */
export const validateParam = <T extends ZodSchema>(schema: T) =>
  createMiddleware(async (c, next) => {
    const rawParams = c.req.param();
    const result = schema.safeParse(rawParams);
    if (!result.success) {
      return sendError(
        c,
        "VALIDATION_ERROR",
        "Path parameter validation failed",
        400,
        result.error.flatten().fieldErrors
      );
    }

    c.set("validParam", result.data);
    await next();
  });

/**
 * Access validated JSON body from context.
 */
export function getValidJson<T extends ZodSchema>(c: Context): z.infer<T> {
  return c.get("validJson");
}

/**
 * Access validated query parameters from context.
 */
export function getValidQuery<T extends ZodSchema>(c: Context): z.infer<T> {
  return c.get("validQuery");
}

/**
 * Access validated path parameters from context.
 */
export function getValidParam<T extends ZodSchema>(c: Context): z.infer<T> {
  return c.get("validParam");
}
