# Backend Layering & Architectural Boundaries

This document defines the architectural boundaries and responsibilities across backend layers in the MoneyComes application.

---

## 1. Layer Responsibilities & Boundaries

```text
HTTP Request
     ↓
┌─────────────────────────────────────────────────────────────┐
│ 1. ROUTE / HTTP LAYER (server/routes/)                      │
│ - Request/Response lifecycle via Hono                       │
│ - Request parsing & schema validation (Zod)                 │
│ - Authentication verification (requireAuth)                 │
│ - Invokes appropriate application service                   │
│ - Maps domain errors to standard HTTP response envelopes   │
│ - NO SQL, NO Drizzle queries, NO business/balance logic     │
└─────────────────────────────────────────────────────────────┘
     ↓ (Plain TypeScript parameters, e.g. actorId, inputData)
┌─────────────────────────────────────────────────────────────┐
│ 2. SERVICE / APPLICATION LAYER (server/services/)           │
│ - Business use case coordination                            │
│ - Authorization policy checks (actor vs resource)          │
│ - Transaction coordination across multiple repositories     │
│ - Pure TypeScript — ZERO Hono/HTTP dependencies             │
│ - Throws domain AppError subclasses (NotFoundError, etc.)   │
└─────────────────────────────────────────────────────────────┘
     ↓ (Entities & DbOrTx client)
┌─────────────────────────────────────────────────────────────┐
│ 3. REPOSITORY / DATA ACCESS LAYER (server/repositories/)     │
│ - Drizzle ORM database queries, inserts, updates, deletes   │
│ - Executes on root db or inside active transaction (DbOrTx) │
│ - Pure persistence concerns — ZERO HTTP/Hono awareness      │
│ - Returns strongly-typed database records                   │
└─────────────────────────────────────────────────────────────┘
     ↓ (SQL execution)
┌─────────────────────────────────────────────────────────────┐
│ 4. DATABASE LAYER (server/db/ via PostgreSQL)               │
│ - Relational tables, indexes, constraints, minor-unit money │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Dependency Flow Rules

- **Allowed Direction**: `HTTP/Routes` → `Services` → `Domain / Repositories` → `Database`.
- **Strictly Prohibited**:
  - Routes directly executing Drizzle SQL queries (`db.select()`, `db.insert()`).
  - Services importing or referencing Hono `Context`, `Request`, or `Response`.
  - Repositories referencing HTTP status codes or request objects.
  - Domain models depending on UI or database frameworks.

---

## 3. Authenticated Identity & Authorization

- **Server-Authoritative Identity**: The authenticated user identity is derived strictly from the verified session in `requireAuth()` and extracted via `getAuthUser(c)`.
- **Service Ingestion**: Routes pass the trusted `actorId: string` to service methods as an explicit parameter:
  ```ts
  // Inside route handler:
  const actor = getAuthUser(c);
  const result = await groupService.getGroupDetails(actor.id, groupId);
  ```
- **Spoofing Prevention**: Services never receive client-supplied `userId` from request bodies or query parameters as proof of identity.
- **Resource Authorization**:
  - Authentication confirms *who the user is*.
  - Authorization confirms *whether the user is permitted to view or modify the requested resource*.
  - The Service layer performs authorization checks and throws `ForbiddenError` on unauthorized access.

---

## 4. Application Error Model & HTTP Mapping

Services throw domain `AppError` instances without referencing HTTP status codes. The centralized `errorHandler` maps them automatically:

| Domain Error | Error Code | HTTP Status | Typical Cause |
|---|---|---|---|
| `NotFoundError` | `NOT_FOUND` | 404 | Target resource does not exist |
| `UnauthorizedError` | `UNAUTHORIZED` | 401 | Session missing, invalid, or expired |
| `ForbiddenError` | `FORBIDDEN` | 403 | Authenticated actor lacks permission |
| `ConflictError` | `CONFLICT` | 409 | Duplicate record, unique key conflict |
| `ValidationError` | `VALIDATION_ERROR` | 400 | Domain or input validation failure |
| `BadRequestError` | `BAD_REQUEST` | 400 | Malformed request or invalid parameters |
| `InternalError` | `INTERNAL_ERROR` | 500 | Unexpected system failure |

All error payloads are normalized by `server/utils/response.ts` into:
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action",
    "requestId": "9f617223-f493-414b-87f6-d3dc963fe831"
  }
}
```

---

## 5. Transaction Boundary

- **Unit of Work**: Complex operations mutating multiple related entities must be atomic.
- **Transaction Coordination**: Belongs to the **Service** layer.
- **`DbOrTx` Pattern**:
  ```ts
  // In server/repositories/types.ts:
  export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

  // In future service workflows (e.g. creating expense and splits):
  await db.transaction(async (tx) => {
    const expense = await expenseRepo.create(expenseData, tx);
    await splitRepo.createMany(splitsData, tx);
  });
  ```
- Ensures ACID compliance and eliminates orphaned financial records on failures.

---

## 6. Test Architecture & Pyramids

- **Unit Tests** (`tests/unit/`):
  - Pure calculation helpers, utilities, Zod schemas, error types.
  - No database or network required.
- **Service Tests**:
  - Application use cases, authorization policies, transaction coordination.
  - Repositories mocked or backed by test database.
- **Repository Tests**:
  - SQL query logic, constraint enforcement, cascade behaviors.
- **API Tests**:
  - End-to-end HTTP request/response validation, middleware verification, status codes.
