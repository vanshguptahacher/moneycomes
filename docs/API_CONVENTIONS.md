# API Conventions & Architecture Guide

This document establishes the architecture conventions for backend routes, middleware, and request/response lifecycles in the MoneyComes application.

---

## 1. API Versioning & Route Structure

- All application business and domain endpoints are namespaced under `/api/v1/`.
- Infrastructure/framework handlers are mounted at root when required:
  - Better Auth endpoints: `/api/auth/**`
  - Root liveness check: `/health` (also aliased under `/api/v1/health`)
- Route files are organized in `server/routes/` by domain module:
  - `server/routes/health.ts`
  - `server/routes/auth.ts`
  - `server/routes/index.ts` (aggregates and mounts sub-routers to `/api/v1`)
  - Future modules (`users.ts`, `groups.ts`, `expenses.ts`, `settlements.ts`) mount into `apiV1Routes` without bloating `server/app.ts`.

---

## 2. Middleware Execution Pipeline

Middleware is applied in a deliberate, strictly enforced sequence in `server/app.ts`:

1. **`requestId()`**:
   - Inspects `X-Request-Id`.
   - Validates format: `/^[a-zA-Z0-9_-]{1,64}$/`. If invalid or missing, generates a secure UUID v4.
   - Sets context variable `c.get("requestId")` and outgoing header `X-Request-Id`.
2. **`structuredLogger()`**:
   - Captures start time, method, path, and request ID.
   - Emits structured JSON access logs (`info`, `warn`, `error`) with elapsed duration (`durationMs`).
   - Never logs tokens, passwords, cookies, authorization headers, or sensitive payload data.
3. **`secureHeaders()`**:
   - Sets baseline HTTP defense headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 0`.
4. **`cors()`**:
   - Manages Cross-Origin Resource Sharing with credentials support and configured `TRUSTED_ORIGINS`.
5. **`bodyLimit()`**:
   - Restricts maximum request body size to 1MB (`1024 * 1024` bytes) to protect against memory exhaustion and DoS attacks.
   - Emits HTTP 413 (`PAYLOAD_TOO_LARGE`) on violation.
6. **Route Handlers**:
   - Auth routes, health probes, and versioned domain sub-routers.
7. **Central Error Handlers**:
   - `onError(errorHandler)`: Formats Zod, HTTPException, and uncaught errors into safe JSON.
   - `notFound(notFoundHandler)`: Handles unmatched endpoints with HTTP 404.

---

## 3. Request Authentication & Protected Routes

- **Authoritative Identity**: The server determines user identity strictly from the verified session via Better Auth.
- **Client Identity Spoofing Protection**:
  - `userId` parameters in headers (`x-user-id`), query parameters (`?userId=...`), or request body are NEVER accepted as proof of identity.
- **Protected Route Convention**:
  ```ts
  import { requireAuth, getAuthUser, getAuthSession } from "../middleware/auth.js";

  routes.get("/profile", requireAuth(), (c) => {
    const user = getAuthUser(c); // Guaranteed non-null
    const session = getAuthSession(c);
    // ...
  });
  ```
- **Unauthenticated Failure**: Automatically returns HTTP 401 Unauthorized with standard error envelope.

---

## 4. Request Validation Convention

- All incoming request inputs must be validated using Zod via `server/middleware/validator.ts`:
  - `validateJson(schema)`: for JSON bodies
  - `validateQuery(schema)`: for query strings
  - `validateParam(schema)`: for route path parameters
- Example:
  ```ts
  import { validateJson, getValidJson } from "../middleware/validator.js";
  import { z } from "zod";

  const createGroupSchema = z.object({
    name: z.string().min(1).max(255),
  });

  groupRoutes.post("/", validateJson(createGroupSchema), (c) => {
    const body = getValidJson<typeof createGroupSchema>(c);
    // ...
  });
  ```
- Validation failures automatically respond with HTTP 400 (`VALIDATION_ERROR`) containing field-level error messages and the request ID.

---

## 5. Standard Response Contracts

### Success Response Format
```json
{
  "data": { ... },
  "meta": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```
Helper: `sendSuccess(c, data, status?, meta?)` from `server/utils/response.ts`.

### Error Response Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "details": {
      "name": ["Required"]
    }
  }
}
```
Helper: `sendError(c, code, message, status?, details?)` from `server/utils/response.ts`.

### Error Codes
- `VALIDATION_ERROR` (400)
- `MALFORMED_JSON` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `PAYLOAD_TOO_LARGE` (413)
- `INTERNAL_ERROR` (500)

---

## 6. Health & Readiness Probes

- **Liveness** (`GET /health`): Confirms process is running and event loop is responsive.
- **Readiness** (`GET /health/ready`): Confirms backing PostgreSQL database is reachable. Returns HTTP 200 (`ready`) when healthy, or HTTP 503 (`degraded`) if database connection fails.
- Never exposes internal database hostnames, credentials, or topology.

---

## 7. Logging & Rate Limiting Strategy

### Logging Rules
- Use JSON structured log lines (`level`, `requestId`, `method`, `path`, `status`, `durationMs`, `timestamp`).
- Never log passwords, tokens, cookies, authorization headers, or financial transaction amounts in plain server logs.

### Rate Limiting Strategy (Production Rollout)
- At baseline, edge proxies (Cloudflare/Nginx) enforce IP-level rate limits.
- Before production deployment, sensitive routes will enforce application-level rate limiting:
  - Auth sign-in: 5 attempts per 15 minutes per IP.
  - Auth sign-up: 3 accounts per hour per IP.
  - Transaction creation: 60 requests per minute per authenticated user.
  - Receipt OCR/Scanning: 10 uploads per hour per user.
