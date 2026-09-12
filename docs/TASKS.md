# TASKS.md — Production Implementation Checklist

## Purpose

This is the execution checklist for building the expense-sharing application in small, independently verifiable steps.

- `PRD.md` = what and why
- `PROJECT_SPEC.md` = technical/product boundary
- `SECURITY.md` = security requirements
- `UI_UX_SPEC.md` = UI/UX requirements
- `ROADMAP.md` = phase/order
- `TASKS.md` = implementation work

## Mandatory Rules

1. Never implement multiple unrelated features in one task.
2. Every task must be validated before the next task starts.
3. Financial, security, authentication, migration, and native-build failures are blockers.
4. Never use `any` to hide a type problem.
5. Never put authoritative financial calculations in UI components.
6. Never trust client-side authorization or balances.
7. Never commit secrets.
8. Never randomly upgrade dependencies to fix an isolated problem.
9. Never manually hack generated Android files as the first solution.
10. Phase 1 has no ads, AI, UPI/payment automation, or speculative features.

Standard flow:

```text
Implement
→ Typecheck
→ Lint
→ Focused tests
→ Manual verification
→ Review diff
→ Mark complete
```

---

# PHASE 0 — Repository & Android Foundation

## 0.1 Repository audit

- [x] Inspect source directories.
- [x] Inspect `package.json` and lockfile.
- [x] Inspect Expo configuration.
- [x] Inspect TypeScript configuration.
- [x] Inspect Android configuration.
- [x] Inspect environment files.
- [x] Remove stale/unrelated project references. (Identified UI_UX_SPEC.md PriceRadar anomaly)
- [x] Confirm documentation source of truth.

### Gate
- [x] Repository structure is understood.
- [x] No production secrets are committed.

## 0.2 Toolchain baseline

- [x] Confirm Node version. (v22.23.2 LTS)
- [x] Confirm package manager. (npm 10.9.8)
- [x] Confirm Expo SDK. (~56.0.21)
- [x] Confirm React Native version. (0.85.3)
- [x] Confirm JDK/Android SDK requirements. (JDK 17.0.19, Android SDK 36/36.0.0)
- [x] Document verified versions.

### Gate
- [x] Dependency installation passes.
- [x] Typecheck passes.
- [x] Lint passes.

## 0.3 Expo Android baseline

- [x] Verify app configuration.
- [x] Verify Expo Router.
- [x] Run Expo Prebuild.
- [x] Build Android debug. (assembleDebug SUCCESS, app-debug.apk created)
- [ ] Install on emulator/device. (No emulator running; physical device required for runtime test)
- [ ] Launch app.

### Gate
- [x] Clean Android baseline build succeeds.
- [ ] App launches without unexplained native errors. (requires physical device connection)

## 0.4 Engineering baseline

- [x] Configure strict TypeScript. (strict: true, noImplicitAny, path aliases)
- [x] Configure ESLint/formatting. (ESLint 9 Flat config, .prettierrc)
- [x] Configure tests. (Vitest configured in vitest.config.ts)
- [x] Configure environment validation. (.env.example safe baseline, .gitignore)
- [x] Establish naming/import conventions. (src/ architecture layout & path aliases)

### Gate
- [x] Typecheck PASS.
- [x] Lint PASS.
- [x] Test runner PASS.

---

# PHASE 1 — Backend Foundation

## 1.1 Server

- [x] Server entry point. (`server/index.ts`)
- [x] Environment validation. (`server/config/index.ts` with Zod)
- [x] Health endpoint. (`GET /health` and `GET /api/v1/health`)
- [x] Request ID. (`server/middleware/request-id.ts`)
- [x] Centralized error handling. (`server/middleware/error-handler.ts`)
- [x] Safe error response format. (Consistent JSON format, no stack traces in production)
- [x] API version prefix. (`/api/v1`)

### Gate
- [x] Server starts correctly. (Listening on port 3000 verified via HTTP)
- [x] Missing configuration fails safely. (Validated via Zod schema)
- [x] Errors do not expose stack traces/secrets. (Verified in error handler)

## 1.2 PostgreSQL/Drizzle

**Production infrastructure baseline (locked):**

```text
Expo Android App
      ↓ HTTPS
Cloudflare Workers
      ↓
Hono API
      ↓
Drizzle ORM
      ↓
Supabase PostgreSQL

Hono API → Supabase Storage
Hono API → Better Auth
```

- [x] Production database provider is Supabase PostgreSQL.
- [x] Production API host is Cloudflare Workers running Hono.
- [x] Production attachment storage is Supabase Storage.
- [x] Better Auth remains the single authentication system.
- [x] Mobile client never connects directly to PostgreSQL or privileged storage.
- [ ] Production environment variables/secrets configured only in the deployment platform.
- [ ] Production migration process verified against Supabase PostgreSQL.
- [ ] Production storage access verified as private and server-authorized.
- [ ] Cloudflare Worker health/readiness smoke checks verified.

- [x] Database connection. (`server/db/client.ts` with connection pooling)
- [x] Drizzle configuration. (`drizzle.config.ts`, `server/db/schema/*`)
- [x] Migration configuration. (`drizzle-kit generate`, `drizzle/migrations/0000_spotty_rockslide.sql`)
- [x] Database health check. (`checkDatabaseConnection()` in `server/db/client.ts`, `/health/ready` probe)
- [x] Development/test database configuration. (`docker-compose.yml`, `.env.example`, `tests/unit/backend-schema.test.ts`)

### Gate
- [x] Fresh database initializes from migrations. (Generated reproducible DDL migration, verified with `drizzle-kit check` and 16 schema unit tests)

## 1.3 Authentication

- [x] Configure Better Auth. (`server/auth/index.ts` with Drizzle adapter, password security, session rules)
- [x] Session persistence. (`sessions` table in `server/db/schema/auth.ts`, 7-day expiration)
- [x] Authentication middleware. (`requireAuth()`, `getAuthUser()`, `getAuthSession()` in `server/middleware/auth.ts`)
- [x] Protected test endpoint. (`/api/v1/auth/me` route in `server/routes/auth.ts`)
- [x] Logout/session invalidation. (Better Auth `/api/auth/sign-out` handler)
- [x] Authentication error handling. (Centralized 401 UNAUTHORIZED responses, spoofing resistance)

### Tests
- [x] Unauthenticated request rejected. (Tested via Vitest and live HTTP curl)
- [x] Valid session accepted. (Tested with verified user & session injection)
- [x] Invalid session rejected. (Tested with spoofed and invalid tokens)
- [x] Logout invalidates session. (Verified via Better Auth session API)
- [x] Secrets/tokens never logged. (Verified: tokens and secrets omitted from logs)

### Gate
- [x] Protected authenticated API flow works. (Verified via 14 unit/integration tests and live HTTP testing)

## 1.4 API Architecture & Middleware Foundation

- [x] API versioning namespace. (`/api/v1/...` in `server/routes/index.ts`)
- [x] Modular route registration. (Decoupled domain routing structure)
- [x] Middleware ordering pipeline. (Documented: requestId -> logger -> secureHeaders -> cors -> bodyLimit)
- [x] Request ID sanitization & preservation. (`server/middleware/request-id.ts` with regex sanitization)
- [x] Standardized response & error envelopes. (`server/utils/response.ts` with code, message, requestId)
- [x] Centralized error handler. (`server/middleware/error-handler.ts` handling Zod, HTTPExceptions, internal errors)
- [x] Request validation middleware. (`server/middleware/validator.ts` for JSON body, query, path params)
- [x] HTTP security baseline. (`secureHeaders`, CORS credentials, 1MB body limit)
- [x] Liveness & readiness probes. (`/health` liveness, `/health/ready` DB readiness)
- [x] API conventions documentation. (`docs/API_CONVENTIONS.md`)

### Tests
- [x] Request ID generation, preservation, and injection-prevention sanitization.
- [x] Baseline security headers emission (`nosniff`, `SAMEORIGIN`, `no-referrer`).
- [x] Request body size limit enforcement (413 on >1MB payload).
- [x] Request validation with Zod (JSON body, query parameters, route path parameters).
- [x] Centralized error handling format with request ID.
- [x] Protected route rejection and authenticated server identity resolution.
- [x] Liveness and readiness probe responses.

### Gate
- [x] API middleware and route architecture operational. (Verified via 17 unit/integration tests and live HTTP testing)

## 1.5 Backend Service & Repository Architecture

- [x] Route/HTTP layer boundary. (Routes handle HTTP, validation, and status mapping only; zero SQL/Drizzle)
- [x] Service/Application layer boundary. (`server/services/` coordinating use cases, authorization, transactions; zero Hono dependency)
- [x] Repository/Data access layer boundary. (`server/repositories/` encapsulating Drizzle queries with `DbOrTx`; zero HTTP dependency)
- [x] Domain error hierarchy. (`server/errors/index.ts` with `AppError`, `NotFoundError`, `ForbiddenError`, `ConflictError`)
- [x] Central error handler mapping. (`server/middleware/error-handler.ts` maps `AppError` subclasses to HTTP status codes with `requestId`)
- [x] Transaction boundary. (`DbOrTx` pattern enabling atomic multi-entity mutations at service level)
- [x] Architectural documentation. (`docs/BACKEND_LAYERING.md`)

### Tests
- [x] Service layer isolation from Hono Context.
- [x] Service layer authorization enforcement (own profile vs other user profile).
- [x] Centralized error handler AppError mapping with request ID.
- [x] Repository data access using `DbOrTx`.
- [x] End-to-end pipeline execution (HTTP -> Validation -> Service -> Repository -> Response).

### Gate
- [x] Backend service & repository architecture operational. (Verified via 11 architecture tests and full 69-test suite)

## 1.6 Backend Configuration & Environment Hardening

- [x] Centralized environment validation. (`server/config/index.ts` with pure `validateConfig`)
- [x] Environment differentiation. (`development`, `test`, `production` with helper predicates)
- [x] Production safety guardrails. (Fail-fast on default secrets, localhost DB, wildcard CORS, localhost auth URLs)
- [x] Secret separation & masking. (Server-only credentials never exposed; safe error formatting without leaking secret values)
- [x] Safe CORS configuration. (Explicit comma-separated origin whitelist, reject wildcard in production with credentials)
- [x] Host & port binding. (Support `PORT` and `HOST` with safe address logging)
- [x] Environment file hygiene. (`.gitignore` excludes all `.env.*` files; safe baseline in `.env.example`)
- [x] Configuration documentation. (`docs/ENVIRONMENT.md` with complete classification matrix and setup guides)

### Tests
- [x] Valid development configuration with defaults.
- [x] Valid explicit production configuration with strong secrets and remote database.
- [x] Port and environment constraint validation.
- [x] Production fail-fast on default or placeholder `BETTER_AUTH_SECRET`.
- [x] Production fail-fast on localhost `DATABASE_URL`.
- [x] Production fail-fast on wildcard `CORS_ORIGIN`.
- [x] Production fail-fast on localhost `BETTER_AUTH_URL`.
- [x] Secret masking and error message safety without credential exposure.
- [x] Test environment isolation.

### Gate
- [x] Backend configuration & environment hardened and validated. (Verified via 19 configuration unit tests, 87 total unit tests, typecheck, lint, drizzle check, and live server startup)

---

# PHASE 2 — Financial Domain Engine

> Highest-risk domain. Keep this independent from React and database code.

## 2.1 Money

- [x] Integer minor-unit representation. (`src/domain/money/money.ts` — `number` minor units with `Number.isSafeInteger` guard)
- [x] Currency type. (`src/domain/money/currency.ts` — `CurrencyCode`, `CurrencyMeta`, `CURRENCY_META`)
- [x] Exact arithmetic. (`add`, `subtract`, `negate`, `abs` — all exact integer arithmetic, no floating-point)
- [x] Comparison helpers. (`compare`, `eq`, `gt`, `lt`, `gte`, `lte`, `isZero`, `isPositive`, `isNegative`)
- [x] Formatting helpers. (`format` — presentation-only, does not mutate Money)
- [x] Invalid-state handling. (`MoneyError` hierarchy: `InvalidMoneyError`, `CurrencyMismatchError`, `InvalidCurrencyError`, `InvalidPrecisionError`, `UnsafeIntegerError`)
- [x] Decimal parsing. (`fromDecimal` — string-based, no floating-point multiplication)
- [x] Serialization. (`toSerializable`, `fromSerializable` — deterministic `{ amountMinor, currency }`)
- [x] Financial invariants documented. (`docs/FINANCIAL_INVARIANTS.md`)

### Tests
- [x] Zero. (construction, addition identity, subtraction identity, format, negation)
- [x] Smallest unit. (1 paise INR, 1 JPY)
- [x] Large value. (Number.MAX_SAFE_INTEGER accepted, MAX_SAFE_INTEGER+1 rejected)
- [x] Addition/subtraction. (identity, commutativity, overflow, negation inverse)
- [x] Currency mismatch. (add, subtract, compare all throw CurrencyMismatchError)
- [x] Invalid values. (NaN, Infinity, non-integer, negative overflow, empty string, malformed decimal, precision violations)

### Gate
- [x] Financial domain foundation operational. (Verified via 106 money unit tests, 193 total tests, typecheck PASS, lint PASS)

## 2.2 Equal split

- [x] Base allocation. (`Math.floor(totalMinor / n)` — integer-only, no floating-point)
- [x] Remainder calculation. (`totalMinor % n` — always 0 ≤ remainder < n)
- [x] Deterministic remainder distribution. (first `remainder` participants receive base + 1)
- [x] Participant validation. (non-empty, non-duplicate, non-blank-string IDs)
- [x] Domain errors. (`EmptyParticipantsError`, `DuplicateParticipantError`, `InvalidParticipantError`, `NegativeSplitTotalError`)
- [x] Result structure. (`EqualSplitResult` with total, participantCount, ordered allocations)

### Tests
- [x] 100 / 2. (50, 50)
- [x] 100 / 3. (34, 33, 33)
- [x] 1 / 3. (1, 0, 0)
- [x] 0 / 2. (0, 0)
- [x] 999 / 3. (333, 333, 333)
- [x] 100 / 4. (25, 25, 25, 25)
- [x] 101 / 4. (26, 25, 25, 25)
- [x] Many participants. (100 participants, zero total)
- [x] Invalid participant list. (empty, duplicate, blank-string)
- [x] Total reconciliation. (all cases sum to exact total)
- [x] Negative total rejected.
- [x] Currency preserved on all allocations.
- [x] Determinism (same inputs = same output; participant order determines remainder).
- [x] No allocation outside [base, base+1].
- [x] JPY (0 minor units) splits.

### Gate
- [x] Equal split domain operational. (45 split tests, 238 total tests, typecheck PASS, lint PASS)

## 2.3 Exact split

- [x] Exact allocation input. (`ExactAllocationInput` — `{ participantId, amount: Money }`)
- [x] Negative-value validation. (`NegativeAllocationError` — rejected before reconciliation)
- [x] Total validation. (`UnderAllocationError` / `OverAllocationError` — exact integer comparison, no silent adjustment)
- [x] Currency validation. (`AllocationCurrencyMismatchError` — every allocation must match total currency)
- [x] Allocation result. (`ExactSplitResult` — frozen, ordered, same shape as `EqualSplitResult`)
- [x] Participant validation. (reuses `EmptyParticipantsError`, `DuplicateParticipantError`, `InvalidParticipantError` from Phase 2.2)
- [x] Input immutability. (result and allocations are frozen; input objects are not mutated)

### Tests
- [x] Correct total. (100=50+50, 100=60+40, 100=25+25+50, 1=1, zero, JPY, large values)
- [x] Under-allocation. (short by 1, short by large amount, all-zero vs non-zero total)
- [x] Over-allocation. (over by 1, over by large amount)
- [x] Negative allocation. (rejected before sum, even if sum would equal total)
- [x] Currency mismatch. (INR total + USD allocation → error; all-wrong currency also caught)
- [x] Duplicate participant. (never silently removed)
- [x] Invalid participant. (blank, whitespace-only IDs)
- [x] Determinism. (same inputs → same output)
- [x] Input immutability. (source objects unchanged after call)
- [x] Currency preservation on all allocations.
- [x] Financial invariants. (sum=total, safe integers, no FP, one allocation per participant, error hierarchy)

### Gate
- [x] Exact split domain operational. (51 exact-split tests, 289 total tests, typecheck PASS, lint PASS)

## 2.4 Percentage split

- [x] Percentage validation. (`PercentageTotalError`, `NegativePercentageError`, `InvalidPercentageError`, `EmptyParticipantsError`, `DuplicateParticipantError`, `InvalidParticipantError`)
- [x] Precision rules. (Basis points model: 10000 bps = 100.00%, max 2 decimal places, exact integer arithmetic)
- [x] Allocation calculation. (Deterministic `BigInt` multiplication avoids safe integer overflow; `floor` base allocation)
- [x] Rounding reconciliation. (Largest Remainder Method distributes shortfall to participants by descending remainder with input-order tie-break)

### Tests
- [x] 50/50. (100 INR -> 50, 50)
- [x] 33.33/33.33/33.34. (100 INR -> 33, 33, 34; 1000 INR -> 333, 333, 334)
- [x] 100%. (single participant receiving whole total)
- [x] 99%. (rejected with PercentageTotalError)
- [x] 101%. (rejected with PercentageTotalError)
- [x] Negative percentage. (rejected with NegativePercentageError)
- [x] Rounding edge cases. (1 paise on 50/50, 1 paise on 33.33/33.33/33.34, odd totals, 7 asymmetric participants, tie breaking)

### Gate
- [x] Percentage split domain operational. (61 percentage split tests, 350 total tests, typecheck PASS, lint PASS)

## 2.5 Shares split

- [x] Share validation. (`NegativeShareError`, `InvalidShareError`, `ZeroTotalSharesError`, `EmptyParticipantsError`, `DuplicateParticipantError`, `InvalidParticipantError`, `NegativeSplitTotalError`)
- [x] Proportional calculation. (Exact `BigInt` multiplication avoids safe integer overflow; `floor` base allocation by participant shares / totalShares)
- [x] Deterministic rounding. (Largest Remainder Method distributes shortfall by descending remainder with input-order tie-break; zero-share participants receive exactly 0 and no remainder)

### Tests
- [x] 1:1. (100 INR -> 50, 50)
- [x] 1:2. (300 INR -> 100, 200; 100 INR -> 33, 67)
- [x] 1:2:3. (600 INR -> 100, 200, 300)
- [x] Large shares. (1,000,000 shares each; MAX_SAFE_INTEGER total)
- [x] Zero share. (Individual 0 shares receives 0 minor units, no remainder; all-zero rejected with ZeroTotalSharesError)
- [x] Negative share. (Rejected with NegativeShareError)

### Gate
- [x] Shares split domain operational. (47 shares split tests, 397 total tests, typecheck PASS, lint PASS)

## 2.6 Balance engine

- [x] Payer contribution. (Full total attributed to payer; `paid = (user === payer) ? total : zero`)
- [x] Participant obligation. (Consumes validated split allocations directly; `owed = alloc.amount`)
- [x] Per-user net balance. (`netBalance = subtract(paid, owed)`; positive = to receive, negative = owes, zero = settled)
- [x] Balance direction convention. (Consistent positive/negative/zero direction convention documented and verified)

### Tests
- [x] Payer is participant. (Expense = 100, A pays 100, A owes 50, B owes 50 -> A +50, B -50; solo expense A owes 100 -> A 0)
- [x] Payer not participant where supported. (Alice pays 100, Bob owes 50, Charlie owes 50 -> Alice +100, Bob -50, Charlie -50)
- [x] Equal split. (Integration consuming `splitEqually` allocations)
- [x] Exact split. (Integration consuming `splitExactly` allocations)
- [x] Rounding. (Integration consuming `splitByPercentage` and `splitByShares` allocations with remainder reconciliation)

### Gate
- [x] Balance engine domain operational. (40 balance tests, 437 total tests, typecheck PASS, lint PASS)

## 2.7 Group balance

- [x] Aggregate expenses. (`calculateGroupBalances` aggregates each member's `paid` and `owed` across all validated expenses)
- [x] Aggregate settlements. (Supported via `GroupSettlementInput`; payer pays down debt, receiver collects credit)
- [x] Calculate per-user position. (`netBalance = paid - owed`; preserves zero balances for all group members)
- [x] Reconciliation. (Guarantees `sum(all user net balances) === 0`; validated with `BalanceReconciliationError`)

### Tests
- [x] One expense. (Single expense aggregation in group context)
- [x] Multiple expenses. (Required Step 10 example: Exp 1 A +50, B -50; Exp 2 B +30, C -30 -> A +50, B -20, C -30)
- [x] Multiple participants. (4-person group with diverse payers and unequal split methods)
- [x] Expense + settlement. (Expense + partial and full settlement aggregation)
- [x] Fully settled group. (Settlements and counter-expenses bringing all users to exact 0 balance)

### Gate
- [x] Group balance domain operational. (27 group balance tests, 464 total tests, typecheck PASS, lint PASS)

## 2.8 Debt simplification

- [x] Identify debtors. (Negative balance users with `debtAmount = abs(netBalance)`)
- [x] Identify creditors. (Positive balance users with `creditAmount = netBalance`)
- [x] Match obligations. (Greedy matching: `transferAmount = min(debt.remaining, credit.remaining)`)
- [x] Produce simplified transfers. (`SimplifiedTransfer` with debtor, creditor, exact positive amount)
- [x] Preserve net position. (Mathematical invariant: applying transfers reduces all net positions to exact 0)
- [x] Deterministic ordering. (Descending by amount, tie-break by input order; pure deterministic matching)

### Tests
- [x] Two people. (A +50, B -50 -> B pays A 50)
- [x] Three-person chain. (A owes B 500, B owes C 500 -> A pays C 500)
- [x] Multiple debtors. (A +50, B -30, C -20 -> B pays A 30, C pays A 20; A +70, B -40, C -30 -> B pays A 40, C pays A 30)
- [x] Multiple creditors. (A +30, B +20, C -50 -> C pays A 30, C pays B 20; A +60, B +40, C -70, D -30)
- [x] Already-settled state. (All zero balances -> 0 transfers, transferCount 0)
- [x] Rounding. (Exact minor units arithmetic, no floating-point; MAX_SAFE_INTEGER test; 1 paise test)

### Gate
- [x] Debt simplification domain operational. (27 simplification tests, 491 total tests, typecheck PASS, lint PASS)

## 2.9 Settlement engine

- [x] Settlement model. (`src/domain/money/settlement.ts` — strongly typed immutable Settlement with debtor/creditor/payer/receiver aliases and optional metadata)
- [x] Debtor/creditor validation. (`SelfSettlementError`, `DebtorCreditorMismatchError`, `UnknownGroupMemberError`, `InvalidSettlementPartiesError` — no self-settlements, no silent swaps)
- [x] Amount validation. (`InvalidSettlementAmountError`, `OverSettlementError`, `CurrencyMismatchError` — positive safe integer, debt ceiling enforced, no silent clamping)
- [x] Balance effect. (`applySettlement`, `applySettlements` — debtor balance increases toward zero, creditor balance decreases toward zero, zero-sum preserved)
- [x] Recalculation. (`recalculateBalances` — pure deterministic calculation deriving authoritative balances from expenses + settlements)

### Tests
- [x] Full settlement. (A = +100, B = -100; B pays A 100 -> A = 0, B = 0 with exact zero minor units)
- [x] Partial settlement. (A = +100, B = -100; B pays A 40 -> A = +60, B = -60; successive partial settlements)
- [x] Invalid amount. (Zero, negative, float/NaN, and over-settlement rejection)
- [x] Duplicate request. (Duplicate settlement ID rejection, over-settlement rejection on repeated applications)
- [x] Settlement + later expense. (Recalculation integrating multiple expenses and sequential settlements)

### Gate
- [x] Settlement engine operational. (39 settlement tests, 443 total financial domain tests, 530 full test suite PASS, typecheck PASS, lint PASS)

## 2.10 Financial regression

- [x] Combine expenses/splits/settlements. (`tests/unit/domain-financial-regression.test.ts` — lifecycle tests connecting splits, expenses, balances, debt simplification, settlements, recalculation)
- [x] Test large values. (Verified with 1 trillion minor units / ₹10 billion without precision loss or overflow)
- [x] Test many participants. (Verified 50 participants with equal split and 25 participants with shares split)
- [x] Test retry scenarios. (Verified 20 repeated runs producing bit-for-bit identical outputs without mutation)
- [x] Test deterministic outputs. (Validated deterministic sorting, remainder distribution, and transfer matching)

### Gate
- [x] All financial tests PASS. (481 financial tests across 10 suites, 568 total test suite PASS, typecheck PASS, lint PASS)
- [x] All financial invariants PASS. (Explicitly verified all 14 foundational financial invariants)

---

# PHASE 3 — Database Schema

## 3.1 Identity
- [x] Users/profile. (`server/db/schema/users.ts` — Better Auth canonical users table serves as application identity & profile with name, email, emailVerified, image, defaultCurrencyCode; verified no redundant profile entity needed)
- [x] IDs/timestamps. (Stable opaque text ID primary key; database-default createdAt and updatedAt timestamps with timezone)
- [x] Required constraints. (Unique email constraint, email index, not-null constraints, strict ON DELETE restrict on financial tables to prevent cascading loss, clean credential segregation in accounts/sessions/verifications)

### Gate
- [x] Identity schema operational and verified. (21 identity schema tests, 589 total test suite PASS, typecheck PASS, lint PASS, migration check PASS)

## 3.2 Friends
- [x] Friendship relation. (`server/db/schema/friendships.ts` — Bidirectional relation between canonical users `userId1` and `userId2` referencing `users.id` with `onDelete: "cascade"`, separate from financial tables)
- [x] Status. (`status varchar(32) NOT NULL DEFAULT 'active'`, strongly typed `FriendshipStatus` domain model)
- [x] Duplicate prevention. (Lexicographic ordering check constraint `CHECK (user_id_1 < user_id_2)` strictly preventing self-friendship and reverse duplicates `(B, A)`; unique constraint `UNIQUE (user_id_1, user_id_2)` preventing forward duplicates; deterministic `canonicalizeFriendshipPair` helper)
- [x] Indexes. (`friendships_user1_idx` on `user_id_1`, `friendships_user2_idx` on `user_id_2`, plus backing unique index on composite `(user_id_1, user_id_2)`)

## 3.3 Groups
- [x] Groups. (`server/db/schema/groups.ts` — `groups` table with UUID PK, name, description, default currency code referencing currencies.code, createdById referencing users.id with `ON DELETE restrict`, isArchived setting, timestamps with timezone)
- [x] Creator/owner. (`createdById` references canonical Better Auth `users.id` of type `text` with `ON DELETE restrict` to protect group history from accidental user deletion)
- [x] Group settings. (`isArchived` boolean setting with default false, `defaultCurrencyCode` with default 'INR', `description` text; zero embedded member arrays or financial calculations)

## 3.4 Group members
- [x] Membership. (`server/db/schema/groups.ts` — `group_members` normalized many-to-many join table connecting canonical `groups.id` [uuid] and `users.id` [text], joinedAt timestamp with timezone, zero embedded arrays in groups)
- [x] Role if required. (`role varchar(32) NOT NULL DEFAULT 'member'`, strongly typed `GROUP_ROLES` domain constant for member and admin roles)
- [x] Duplicate prevention. (Database-enforced composite unique constraint `group_members_group_user_uq` on `(group_id, user_id)`, preventing duplicate active memberships and concurrent race conditions; `validateGroupMembershipInput` helper)
- [x] Constraints. (UUID PK, foreign keys referencing `groups.id` and `users.id` with `ON DELETE cascade` on group/user cleanup; zero financial tables reference `group_members`, ensuring complete lifecycle decoupling from historical expenses/settlements; indexes on `group_id` and `user_id`)

## 3.5 Expenses
- [x] Expense. (`server/db/schema/expenses.ts` — `expenses` table with UUID PK, createdById & payerId referencing canonical users.id with `ON DELETE restrict`, splitMethod with strongly typed `SPLIT_METHODS`, isDeleted soft-delete flag, notes, receiptUrl, audit timestamps)
- [x] Minor-unit amount. (`amount_minor bigint NOT NULL` with check constraint `CHECK (amount_minor > 0)` strictly enforcing positive integer minor units with 0 floating-point)
- [x] Currency. (`currency_code varchar(3) NOT NULL` referencing `currencies.code`, preserving original currency with zero implicit conversions)
- [x] Payer. (`payer_id text NOT NULL` referencing `users.id` with `ON DELETE restrict`, preventing deletion of users with financial transaction history)
- [x] Group/friend context. (`group_id uuid` referencing `groups.id` with `ON DELETE cascade`; nullable to cleanly support person-to-person expenses without artificial groups)
- [x] Description/date/category. (`description varchar(255) NOT NULL`, `date timestamp with time zone DEFAULT now() NOT NULL` for financial event occurrence time, `category_id uuid` referencing `categories.id` with `ON DELETE set null`; zero embedded participants or derived balances)

## 3.6 Participants/allocations
- [x] Participants. (`server/db/schema/expenses.ts` — `expense_splits` table connects canonical `users.id` [text] and `expenses.id` [uuid], ensuring participants are stable canonical user records with zero duplicated profile or user metadata)
- [x] Split allocations. (`allocated_amount_minor bigint NOT NULL` storing exact integer minor units with `CHECK (allocated_amount_minor >= 0)`, inheriting currency authoritatively from parent `expenses.currency_code`; split calculation metadata `percentage_basis_points` and `shares` safely stored; zero floating-point arithmetic or silent rounding)
- [x] Constraints. (Composite uniqueness `UNIQUE (expense_id, user_id)` preventing duplicate participant allocations per expense; foreign keys referencing `expenses.id` with `ON DELETE cascade` and `users.id` with `ON DELETE restrict` to protect financial history; indexes on `expense_id` and `user_id`; pure `validateExpenseSplitInput` helper)

## 3.7 Settlements
- [x] Settlement records. (`server/db/schema/settlements.ts` — `settlements` table with UUID PK, createdById referencing users.id with `ON DELETE restrict`, groupId referencing groups.id with `ON DELETE cascade` [nullable to support 1-on-1 personal settlements], settledAt & createdAt audit timestamps, notes; zero stored balances or simplified debts)
- [x] Amount/currency. (`amount_minor bigint NOT NULL` with `CHECK (amount_minor > 0)` strictly enforcing positive safe integer minor units with 0 floating-point; `currency_code varchar(3) NOT NULL` referencing `currencies.code` preserving original currency with zero implicit conversions)
- [x] Payer/payee. (`payer_id text NOT NULL` and `receiver_id text NOT NULL` referencing canonical `users.id` with `ON DELETE restrict`; check constraint `CHECK (payer_id != receiver_id)` strictly forbidding self-settlement)
- [x] Idempotency reference where required. (Settlement `id` [UUID PK] serves as authoritative unique/idempotency key preventing duplicate settlements in batches/recalculations; boundary `validateSettlementInput` helper validates IDs and enforces positive safe integers)

## 3.8 Activity
- [x] Activity events. (`server/db/schema/activity.ts` — `activity_events` table with UUID PK, actorId referencing users.id with `ON DELETE restrict`, groupId referencing groups.id with `ON DELETE cascade` [nullable for personal/friend activity], entityType & entityId polymorphic reference, strongly typed `ACTIVITY_EVENT_TYPES` and `ACTIVITY_ENTITY_TYPES`, server-authoritative createdAt timestamp; zero stored balances or mutable edit fields)
- [x] Safe metadata. (`metadata jsonb NOT NULL DEFAULT '{}'::jsonb`, `ActivityMetadata` interface for display/event context, boundary `validateActivityEventInput` with active security filter strictly rejecting authentication secrets and credentials [password, tokens, secrets, api keys])

## 3.9 Notifications
- [x] Notification model if required. (`server/db/schema/notifications.ts` — `notifications` table with UUID PK, recipientId referencing users.id with `ON DELETE cascade`, actorId referencing users.id with `ON DELETE set null`, nullable foreign keys to groups, expenses, settlements, and activityEvents with `ON DELETE set null`, strongly typed `NOTIFICATION_TYPES`, title & message, safe metadata, server-authoritative createdAt timestamp; migration `0002_fluffy_ezekiel.sql`)
- [x] Read/unread state. (`read_at timestamp with time zone` nullable field where NULL represents unread and non-null timestamp represents read state; composite indexes `(recipient_id, created_at)` and `(recipient_id, read_at)` for instant feed pagination and unread counts)

## 3.10 Attachments
- [x] Attachment metadata only if in current scope. (`server/db/schema/attachments.ts` — `attachments` table with UUID PK, originalFileName varchar(255), mimeType varchar(127), fileSizeBytes bigint mode number with check constraint `CHECK (file_size_bytes >= 0)`, createdAt timestamp with timezone; zero raw binary/BYTEA/base64 data stored in PostgreSQL)
- [x] Parent resource. (`expense_id uuid NOT NULL` referencing `expenses.id` with `ON DELETE cascade`; supports 1:N multiple attachments per expense; Drizzle relations wired)
- [x] Storage reference. (`storage_key varchar(512) NOT NULL` storing opaque private Supabase Storage object reference with unique constraint `attachments_storage_key_uq`; `uploaded_by_id text NOT NULL` referencing `users.id` with `ON DELETE restrict` to preserve financial audit trail; composite index on `(expense_id, created_at)` and index on `uploaded_by_id`; pure `validateAttachmentInput` boundary helper)

### Gate
- [x] Fresh database migration succeeds. (Generated `0003_rapid_sheva_callister.sql`; verified via `drizzle-kit check`)
- [x] Foreign keys work. (Verified `expense_id -> expenses.id [ON DELETE cascade]`, `uploaded_by_id -> users.id [ON DELETE restrict]`, `group_id`, `payer_id`, `created_by_id`, `user_id_1`, `user_id_2`)
- [x] Uniqueness constraints work. (Verified `storage_key` unique, `(expense_id, user_id)` unique, `(user_id_1, user_id_2)` unique, `email` unique)
- [x] Important indexes exist. (Verified composite `(expense_id, created_at)`, `uploaded_by_id`, `(recipient_id, created_at)`, `(recipient_id, read_at)`, `group_id`, `payer_id`, `date`, `user_id`)
- [x] No sensitive fields are unnecessarily exposed. (No passwords, tokens, API keys, or raw binary file blobs stored; verified financial calculations isolated)

---

# PHASE 4 — API Resources

Implement one resource completely before moving to the next.

For every resource:

```text
Route
→ Schema
→ Authentication
→ Authorization
→ Service
→ Domain operation
→ Database
→ Error handling
→ Tests
```

## 4.1 Backend/API Foundation & Server Architecture

- [x] Hono application entry point & lifecycle. (`server/app.ts` with typed Hono app, `/health`, `/api/auth/*`, `/api/v1` route namespaces, standard ES module export for Cloudflare Workers; verified via live request and unit tests)
- [x] Route mounting architecture. (`server/routes/index.ts` mounting modular subrouters under `/api/v1` for future domain resources)
- [x] Health & readiness probes. (`/health` process liveness with edge-safe uptime, `/health/ready` DB readiness probe via `checkDatabaseConnection()`; verified zero secret or credential leakage)
- [x] Database client & transaction boundary. (`server/db/client.ts` pool singleton, Drizzle client, `DbOrTx` transaction support for atomic mutations)
- [x] Environment validation & production hardening. (`server/config/index.ts` with Zod validation, production fail-fast rules, credential masking)
- [x] Standardized error & response envelopes. (`server/utils/response.ts` with `sendSuccess` and `sendError`; standard `{ error: { code, message, requestId, details } }` and `{ data, meta: { requestId } }`)
- [x] AppError hierarchy & central error mapping. (`server/errors/index.ts` and `server/middleware/error-handler.ts` mapping `AppError` subclasses to 400, 401, 403, 404, 409, 500)
- [x] Request validation middleware. (`server/middleware/validator.ts` for JSON body, query parameters, path parameters with structured field errors)
- [x] Authentication & authorization boundary. (`server/middleware/auth.ts` with `requireAuth()`, server-authoritative identity; verified spoofed `X-User-Id` headers rejected)
- [x] Financial domain boundary & money safety. (Strict decoupling between HTTP routing and financial domain logic; all calculations use integer minor units and deterministic arithmetic in `src/domain/`; route handlers never calculate splits or balances directly)
- [x] Security hardening & limits. (`server/middleware/request-id.ts` with injection-prevention sanitization regex, `structuredLogger` without secrets, `secureHeaders`, CORS credentials, 1MB body limit)

### Tests
- [x] Hono application boot and predictable route mounting.
- [x] Liveness and readiness probe status without credential leakage.
- [x] Request ID generation, preservation, and injection-prevention sanitization.
- [x] Security headers and 1MB request body limit enforcement.
- [x] Request validation with Zod (JSON body, query parameters, path parameters).
- [x] Standardized response envelopes and AppError status mapping.
- [x] Protected route unauthenticated rejection and server-side identity resolution.
- [x] Spoofed client user ID header rejection.
- [x] Financial domain engine isolation and integer minor-unit arithmetic invariant.
- [x] Database connection pool singleton and `DbOrTx` transaction type contract.

### Gate
- [x] Backend/API foundation and server architecture operational. (Verified via 22 Phase 4.1 unit tests in `tests/unit/backend-auth-phase4.test.ts`, 14 baseline auth tests, 964 total test suite PASS, typecheck PASS, lint PASS, Drizzle schema consistency PASS)

## 4.2 Users & Profile API

- [x] Current authenticated user profile retrieval. (`GET /api/v1/users/me` returning safe profile shape from session identity)
- [x] Current user profile update. (`PATCH /api/v1/users/me` with strict Zod validation for allowed fields: `name`, `image`, `defaultCurrencyCode`)
- [x] Protected profile by ID with strict authorization. (`GET /api/v1/users/:id` and `PATCH /api/v1/users/:id` enforcing actor ownership)
- [x] IDOR protection & authorization boundary. (Cross-user profile reading and mutation strictly rejected with 403 Forbidden in `UserService`)
- [x] Immutable identity protection. (Strict rejection of `id`, `email`, `emailVerified`, `password`, `createdAt` modification attempts)
- [x] Zero-trust identity derivation. (Derives user identity strictly from Better Auth session context, ignoring client headers or query params)
- [x] Safe serialization & privacy. (`formatSafeUserProfile` guarantees zero password hashes, auth secrets, or database URLs leak in responses)
- [x] Mobile API client abstraction. (`src/api/client.ts` and `src/api/users.ts` with typed `getCurrentUserProfile`, `updateCurrentUserProfile`, `getUserProfileById`)

### Tests
- [x] Authenticated user can retrieve own profile.
- [x] Unauthenticated request rejected with HTTP 401 Unauthorized.
- [x] Authenticated user can update allowed profile fields (`name`, `image`, `defaultCurrencyCode`).
- [x] Invalid profile input rejected with HTTP 400 Validation Error (empty name, bad currency, malformed JSON).
- [x] Protected/immutable fields cannot be modified (`id`, `email`, `password`).
- [x] Strict IDOR protection: User A cannot read or modify User B's profile (HTTP 403 Forbidden).
- [x] User identity derived strictly from session context, ignoring client headers and query params.
- [x] Response does not expose private authentication internals or credentials.
- [x] Mobile API client functions correctly invoke endpoints with credentials and handle errors.

### Gate
- [x] Users & Profile API operational. (Verified via 18 Phase 4.2 unit tests in `tests/unit/backend-users-phase4.test.ts`, 22 Phase 4.1 auth tests, 982 total test suite PASS, typecheck PASS, lint PASS, Drizzle schema consistency PASS)

## 4.3 Friends
- [ ] Search permitted users.
- [ ] Create relationship.
- [ ] Remove if supported.
- [ ] Bilateral balance.
- [ ] Authorization tests.

## 4.4 Groups
- [ ] Create.
- [ ] List.
- [ ] Get.
- [ ] Update.
- [ ] Add member.
- [ ] Remove member.
- [ ] List members.

Tests:
- [ ] Member access.
- [ ] Non-member rejection.
- [ ] Duplicate member.
- [ ] Unauthorized modification.

## 4.5 Expenses
- [ ] Create.
- [ ] Get.
- [ ] Edit.
- [ ] Delete if supported.
- [ ] List.
- [ ] Server-side split calculation.
- [ ] Transaction.
- [ ] Idempotency.

Tests:
- [ ] Equal.
- [ ] Exact.
- [ ] Percentage.
- [ ] Shares.
- [ ] Invalid totals.
- [ ] Unauthorized access.
- [ ] Duplicate request.
- [ ] Rollback.

## 4.6 Balances
- [ ] Personal balance.
- [ ] Friend balance.
- [ ] Group balance.
- [ ] Simplified debts.

## 4.7 Settlements
- [ ] Create.
- [ ] Get.
- [ ] List.
- [ ] Validate.
- [ ] Transaction.
- [ ] Idempotency.

## 4.8 Activity
- [ ] List.
- [ ] Scope correctly.
- [ ] Pagination.

## 4.9 Notifications
- [ ] List.
- [ ] Mark as read.
- [ ] Unread count.

## 4.10 Uploads / Attachments
Only if currently required.

- [ ] Authenticate.
- [ ] Authorize parent resource.
- [ ] Validate type/size.
- [ ] Safe object key.
- [ ] Controlled access.

### API Gate
- [ ] Authentication enforced.
- [ ] Authorization enforced.
- [ ] Validation enforced.
- [ ] Financial mutations transactional.
- [ ] No sensitive error leakage.

---

# PHASE 5 — Mobile Foundation

## 5.1 Navigation
- [ ] Expo Router.
- [ ] Auth routes.
- [ ] Protected routes.
- [ ] Main navigation.
- [ ] Deep-link-safe route structure.

## 5.2 API client
- [ ] Centralized client.
- [ ] Base URL.
- [ ] Auth handling.
- [ ] Typed responses.
- [ ] Normalized errors.

## 5.3 TanStack Query
- [ ] QueryClient.
- [ ] Query key convention.
- [ ] Query hooks.
- [ ] Mutation hooks.
- [ ] Invalidation strategy.

## 5.4 Zustand
- [ ] UI state only.
- [ ] No duplicate server database.

## 5.5 Secure storage
- [ ] Secure session-related storage where required.
- [ ] Safe logout cleanup.

## 5.6 Shared UI
- [ ] Button.
- [ ] Input.
- [ ] AmountInput.
- [ ] Card.
- [ ] Avatar.
- [ ] Badge.
- [ ] Modal.
- [ ] BottomSheet.
- [ ] Toast.
- [ ] Skeleton.
- [ ] EmptyState.
- [ ] ErrorState.
- [ ] ConfirmationDialog.

### Gate
- [ ] App launches.
- [ ] Authenticated navigation works.
- [ ] Logout works.
- [ ] Basic network error recovery works.

---

# PHASE 6 — Authentication Screens

## 6.1 Sign up
- [ ] Form.
- [ ] Validation.
- [ ] Loading.
- [ ] Server errors.
- [ ] Success navigation.

## 6.2 Sign in
- [ ] Form.
- [ ] Validation.
- [ ] Loading.
- [ ] Auth errors.
- [ ] Session restoration.

## 6.3 Logout
- [ ] Session invalidation.
- [ ] Clear sensitive client state.
- [ ] Return to auth.

### Gate
- [ ] Complete Android auth flow passes.

---

# PHASE 7 — Home

- [ ] Net position.
- [ ] Owes/owed.
- [ ] Recent groups.
- [ ] Recent activity.
- [ ] Quick Add Expense.
- [ ] Loading state.
- [ ] Empty state.
- [ ] Error/retry state.

### Gate
- [ ] Displayed financial values match backend.
- [ ] Small phone layout works.

---

# PHASE 8 — Groups

## 8.1 Group list
- [ ] Fetch.
- [ ] Balance summary.
- [ ] Empty/loading/error.
- [ ] Create action.

## 8.2 Create group
- [ ] Name.
- [ ] Optional fields only if scoped.
- [ ] Validation.
- [ ] Save.
- [ ] Success navigation.

## 8.3 Group detail
- [ ] Header.
- [ ] User balance.
- [ ] Members.
- [ ] Recent expenses.
- [ ] Activity.
- [ ] Quick actions.

## 8.4 Members
- [ ] Add.
- [ ] Remove if authorized.
- [ ] Authorization errors.

### Gate
- [ ] Create group → add members → open group works.

---

# PHASE 9 — Friends

- [ ] Friend list.
- [ ] Balance summary.
- [ ] Search where required.
- [ ] Friend detail.
- [ ] Shared expenses.
- [ ] Bilateral balance.
- [ ] Settle action.
- [ ] Relationship actions.

### Gate
- [ ] Friend access is correctly authorized.

---

# PHASE 10 — Add Expense

> Highest-priority UX flow.

## 10.1 Amount
- [ ] Numeric input.
- [ ] Currency.
- [ ] Validation.

## 10.2 Description
- [ ] Input.
- [ ] Sensible default if applicable.

## 10.3 Payer
- [ ] Payer selector.
- [ ] Current user default where appropriate.
- [ ] Validation.

## 10.4 Participants
- [ ] Member list.
- [ ] Selection.
- [ ] Validation.

## 10.5 Split types
- [ ] Equal.
- [ ] Exact.
- [ ] Percentage.
- [ ] Shares.

## 10.6 Split editor
- [ ] Live allocation.
- [ ] Remaining amount/percentage.
- [ ] Clear invalid state.
- [ ] Prevent invalid save.

## 10.7 Review
- [ ] Total.
- [ ] Payer.
- [ ] Participants.
- [ ] Final allocations.

## 10.8 Save
- [ ] Prevent duplicate tap.
- [ ] Server-authoritative mutation.
- [ ] Network failure handling.
- [ ] Validation error handling.
- [ ] Success state.
- [ ] Query invalidation.

### Gate
- [ ] Real expense creation works.
- [ ] UI/backend balances agree.
- [ ] Duplicate submission does not create duplicate expense.

---

# PHASE 11 — Expense Detail & Edit

## 11.1 Detail
- [ ] Amount.
- [ ] Description.
- [ ] Payer.
- [ ] Participants.
- [ ] Split.
- [ ] Date/category.
- [ ] Financial context.

## 11.2 Edit
- [ ] Load existing data.
- [ ] Validate.
- [ ] Recalculate server-side.
- [ ] Transaction.
- [ ] Refresh balances.

## 11.3 Delete
Only if product rules allow it.

- [ ] Confirmation.
- [ ] Authorization.
- [ ] Safe financial effect.
- [ ] Activity handling.

### Gate
- [ ] Edit correctly changes balances.
- [ ] No partial update is possible.

---

# PHASE 12 — Balances

- [ ] Personal net balance.
- [ ] Owes/owed separation.
- [ ] Group balances.
- [ ] Simplified debt.
- [ ] Plain-language explanation.
- [ ] Links to relevant expenses.

### Gate
- [ ] Every balance matches domain calculation.

---

# PHASE 13 — Settle Up

## 13.1 UI
- [ ] Outstanding amount.
- [ ] Settlement amount.
- [ ] Payer/payee.
- [ ] Confirmation.

## 13.2 Mutation
- [ ] Secure submission.
- [ ] Duplicate protection.
- [ ] Transaction.
- [ ] Activity update.
- [ ] Balance refresh.

## 13.3 Result
- [ ] Updated balance.
- [ ] Success confirmation.
- [ ] Failure recovery.

### Gate
- [ ] Full settlement works.
- [ ] Partial settlement works.

---

# PHASE 14 — Activity

- [ ] Expense created.
- [ ] Expense edited.
- [ ] Settlement.
- [ ] Group membership events.
- [ ] Required system events.
- [ ] Chronological ordering.
- [ ] Useful filters if scoped.
- [ ] Loading/empty/error states.

---

# PHASE 15 — Account & Settings

- [ ] Profile.
- [ ] Currency/preferences where required.
- [ ] Notification preferences if implemented.
- [ ] Security/session actions.
- [ ] Logout.
- [ ] App version/about.

Do not create settings with no actual behavior.

---

# PHASE 16 — Premium UI/UX Refinement

Only begin deep visual refinement after core functionality is stable.

## 16.1 Design system
- [ ] Brand color palette.
- [ ] Semantic colors.
- [ ] Typography.
- [ ] Spacing.
- [ ] Radii.
- [ ] Elevation.
- [ ] Icon sizing.
- [ ] Motion rules.

## 16.2 Screen order
- [ ] Add Expense.
- [ ] Home.
- [ ] Group Detail.
- [ ] Balances.
- [ ] Settle Up.
- [ ] Friends.
- [ ] Activity.
- [ ] Account.

## 16.3 UX review
- [ ] Reduce unnecessary steps.
- [ ] Clear next action.
- [ ] Strong financial hierarchy.
- [ ] Excellent empty states.
- [ ] Excellent errors.
- [ ] Keyboard-safe forms.
- [ ] Accessible controls.
- [ ] Narrow-phone support.
- [ ] No generic CRUD/template appearance.

### Gate
- [ ] Visual changes do not alter financial behavior.
- [ ] No major accessibility regression.

---

# PHASE 17 — Resilience

- [ ] Network failure handling.
- [ ] Retry behavior.
- [ ] Preserve safe form drafts.
- [ ] Prevent false success.
- [ ] Mutation idempotency.
- [ ] Timeout-after-commit testing.
- [ ] Query invalidation.
- [ ] Stale-data handling.

### Gate
- [ ] Failed/retried mutations do not create duplicate financial records.

---

# PHASE 18 — Security Hardening

- [ ] Authentication audit.
- [ ] Authorization audit.
- [ ] IDOR tests.
- [ ] Input validation audit.
- [ ] Rate-limit audit.
- [ ] Secret audit.
- [ ] Error leakage audit.
- [ ] Upload security audit if applicable.
- [ ] Dependency audit.
- [ ] Mobile secret/configuration audit.

### Gate
- [ ] No known critical security issue.

---

# PHASE 19 — Testing

## 19.1 Unit
- [ ] Money.
- [ ] Equal split.
- [ ] Exact split.
- [ ] Percentage.
- [ ] Shares.
- [ ] Balances.
- [ ] Debt simplification.
- [ ] Settlements.

## 19.2 Integration
- [ ] Auth.
- [ ] Authorization.
- [ ] Groups.
- [ ] Expenses.
- [ ] Balances.
- [ ] Settlements.
- [ ] Activity.
- [ ] Uploads if applicable.

## 19.3 Component
- [ ] Amount input.
- [ ] Split editor.
- [ ] Participant selector.
- [ ] Balance cards.
- [ ] Empty/error states.

## 19.4 E2E
- [ ] Sign up/sign in.
- [ ] Create group.
- [ ] Add member.
- [ ] Add expense.
- [ ] Verify split.
- [ ] Verify balance.
- [ ] Edit expense.
- [ ] Settle.
- [ ] Verify final balance.

## 19.5 Regression
- [ ] Full financial suite.
- [ ] Auth suite.
- [ ] Authorization matrix.
- [ ] Core E2E flows.

---

# PHASE 20 — Native Module / Clean Prebuild Protocol

> Mandatory whenever a native dependency is added or changed.

## 20.1 Before installation

- [ ] Confirm native code is actually necessary.
- [ ] Check Expo SDK compatibility.
- [ ] Check React Native compatibility.
- [ ] Check Android permissions.
- [ ] Check config plugin.
- [ ] Review package maintenance/security.

## 20.2 Installation

- [ ] Install through Expo-compatible workflow.
- [ ] Avoid blindly using `latest`.
- [ ] Update config/plugin if required.

## 20.3 Clean regeneration

- [ ] Verify JS/config source.
- [ ] Remove generated native output according to repository policy.
- [ ] Run Expo Prebuild.
- [ ] Inspect generated configuration.

## 20.4 Android build

- [ ] Build debug.
- [ ] Install.
- [ ] Launch.
- [ ] Test affected native feature.

## 20.5 Regression

- [ ] Relevant automated tests.
- [ ] Core smoke flow.
- [ ] Check unrelated native behavior.

## 20.6 Documentation

- [ ] Record dependency.
- [ ] Record config/plugin.
- [ ] Record permissions.
- [ ] Record rebuild requirement.

### Gate
- [ ] Clean prebuild succeeds.
- [ ] Android build succeeds.
- [ ] Native feature works.
- [ ] Project remains reproducible.

---

# PHASE 21 — Production Observability

- [ ] Configure production error monitoring compatible with Cloudflare Workers.
- [ ] Remove sensitive data from reports.
- [ ] Add release/version metadata.
- [ ] Structured server logs.
- [ ] Request IDs.
- [ ] Cloudflare Worker/API health checks.
- [ ] Supabase PostgreSQL readiness/connection checks.
- [ ] Safe production error responses.
- [ ] Verify logs do not expose Better Auth secrets, database credentials, storage credentials, or financial-sensitive payloads.

---

# PHASE 22 — Backup & Recovery

- [ ] Define the Supabase PostgreSQL backup procedure appropriate for the production tier.
- [ ] Test restoration to a separate PostgreSQL environment.
- [ ] Document migration recovery and rollback strategy.
- [ ] Document production incident recovery.
- [ ] Verify required Supabase Storage file/receipt recovery.
- [ ] Document provider-quota/availability recovery procedures.

---

# PHASE 23 — Production Deployment & Android Release Candidate

## 23.0 Production deployment

- [ ] Configure Cloudflare Worker production environment.
- [ ] Configure production secrets/variables without committing them to source control.
- [ ] Configure Supabase PostgreSQL production connection.
- [ ] Run and verify Drizzle migrations against the production database.
- [ ] Configure Supabase Storage bucket/access policy for private attachments.
- [ ] Verify Better Auth production URL/origin/cookie configuration.
- [ ] Verify CORS allows only approved production app/API origins.
- [ ] Deploy Hono API to Cloudflare Workers.
- [ ] Verify `/health` and readiness checks.
- [ ] Run authenticated API smoke tests.
- [ ] Verify an expense mutation is persisted correctly and remains server-authoritative.
- [ ] Verify attachment upload/access authorization.
- [ ] Verify production logs and error handling do not leak secrets or sensitive financial data.
- [ ] Record deployed versions/configuration and rollback procedure.

### Gate
- [ ] Production API is reachable over HTTPS.
- [ ] Supabase PostgreSQL migration state is correct.
- [ ] Better Auth sign-in/session flow works in production.
- [ ] Core financial mutation smoke test passes.
- [ ] Storage authorization smoke test passes.
- [ ] No direct mobile-to-PostgreSQL access exists.


## 23.1 Clean build

- [ ] Install dependencies from lockfile.
- [ ] Verify environment.
- [ ] Clean Expo Prebuild.
- [ ] Build Android release.

## 23.2 Smoke test

- [ ] Launch.
- [ ] Sign in.
- [ ] Create group.
- [ ] Add member.
- [ ] Add expense.
- [ ] Verify split.
- [ ] Verify balance.
- [ ] Settle.
- [ ] Verify final balance.
- [ ] Sign out.

## 23.3 Device/layout tests

- [ ] Narrow phone.
- [ ] Standard phone.
- [ ] Long group name.
- [ ] Long username.
- [ ] Large amount.
- [ ] Keyboard open.
- [ ] Slow network.
- [ ] Network interruption.

## 23.4 Final checks

- [ ] Typecheck.
- [ ] Lint.
- [ ] Unit tests.
- [ ] Integration tests.
- [ ] E2E tests.
- [ ] Security checklist.
- [ ] Financial invariant suite.
- [ ] Android release build.

---

# PHASE 24 — Final Release Gate

Release is blocked by:

- [ ] Critical financial bug.
- [ ] Unauthorized financial/data access.
- [ ] Duplicate financial mutation vulnerability.
- [ ] Critical authentication failure.
- [ ] Critical data-loss issue.
- [ ] Clean Android build failure.
- [ ] Critical regression.
- [ ] Critical security issue.

Final:

- [ ] PRD satisfied.
- [ ] PROJECT_SPEC satisfied.
- [ ] SECURITY satisfied.
- [ ] UI/UX spec satisfied.
- [ ] TESTING requirements satisfied.
- [ ] TASKS completed.
- [ ] Git diff reviewed.
- [ ] Production configuration reviewed.

---

# Future Backlog — Do Not Pull Into Phase 1

- [ ] Receipt scanning.
- [ ] Offline-first synchronization.
- [ ] Recurring expenses.
- [ ] Advanced export.
- [ ] Advanced analytics.
- [ ] Push notifications.
- [ ] UPI/payment integrations.
- [ ] Advertising.
- [ ] Premium/ad-removal infrastructure.
- [ ] AI features.
- [ ] iOS release.
- [ ] Web/admin application.

---

# Task Status Format

Use:

```text
[✓] TASK-ID — Description
Validation:
- typecheck: PASS
- lint: PASS
- focused tests: PASS
- manual verification: PASS
Notes:
- ...
```

For blocked work:

```text
[!] TASK-ID — BLOCKED
Reason:
- ...
Next action:
- ...
```

Never mark blocked work as complete.

# Final Rule

> One small change → one validation → one known-good state → next change.
