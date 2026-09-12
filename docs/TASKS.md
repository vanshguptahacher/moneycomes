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

- [ ] Base allocation.
- [ ] Remainder calculation.
- [ ] Deterministic remainder distribution.
- [ ] Participant validation.

### Tests
- [ ] 100 / 2.
- [ ] 100 / 3.
- [ ] 1 / 3.
- [ ] Many participants.
- [ ] Invalid participant list.
- [ ] Total reconciliation.

## 2.3 Exact split

- [ ] Exact allocation input.
- [ ] Negative-value validation.
- [ ] Total validation.
- [ ] Allocation result.

### Tests
- [ ] Correct total.
- [ ] Under-allocation.
- [ ] Over-allocation.
- [ ] Duplicate participant.
- [ ] Invalid participant.

## 2.4 Percentage split

- [ ] Percentage validation.
- [ ] Precision rules.
- [ ] Allocation calculation.
- [ ] Rounding reconciliation.

### Tests
- [ ] 50/50.
- [ ] 33.33/33.33/33.34.
- [ ] 100%.
- [ ] 99%.
- [ ] 101%.
- [ ] Negative percentage.
- [ ] Rounding edge cases.

## 2.5 Shares split

- [ ] Share validation.
- [ ] Proportional calculation.
- [ ] Deterministic rounding.

### Tests
- [ ] 1:1.
- [ ] 1:2.
- [ ] 1:2:3.
- [ ] Large shares.
- [ ] Zero share.
- [ ] Negative share.

## 2.6 Balance engine

- [ ] Payer contribution.
- [ ] Participant obligation.
- [ ] Per-user net balance.
- [ ] Balance direction convention.

### Tests
- [ ] Payer is participant.
- [ ] Payer not participant where supported.
- [ ] Equal split.
- [ ] Exact split.
- [ ] Rounding.

## 2.7 Group balance

- [ ] Aggregate expenses.
- [ ] Aggregate settlements.
- [ ] Calculate per-user position.
- [ ] Reconciliation.

### Tests
- [ ] One expense.
- [ ] Multiple expenses.
- [ ] Multiple participants.
- [ ] Expense + settlement.
- [ ] Fully settled group.

## 2.8 Debt simplification

- [ ] Identify debtors.
- [ ] Identify creditors.
- [ ] Match obligations.
- [ ] Produce simplified transfers.
- [ ] Preserve net position.
- [ ] Deterministic ordering.

### Tests
- [ ] Two people.
- [ ] Three-person chain.
- [ ] Multiple debtors.
- [ ] Multiple creditors.
- [ ] Already-settled state.
- [ ] Rounding.

## 2.9 Settlement engine

- [ ] Settlement model.
- [ ] Debtor/creditor validation.
- [ ] Amount validation.
- [ ] Balance effect.
- [ ] Recalculation.

### Tests
- [ ] Full settlement.
- [ ] Partial settlement.
- [ ] Invalid amount.
- [ ] Duplicate request.
- [ ] Settlement + later expense.

## 2.10 Financial regression

- [ ] Combine expenses/splits/settlements.
- [ ] Test large values.
- [ ] Test many participants.
- [ ] Test retry scenarios.
- [ ] Test deterministic outputs.

### Gate
- [ ] All financial tests PASS.
- [ ] All financial invariants PASS.

---

# PHASE 3 — Database Schema

## 3.1 Identity
- [ ] Users/profile.
- [ ] IDs/timestamps.
- [ ] Required constraints.

## 3.2 Friends
- [ ] Friendship relation.
- [ ] Status.
- [ ] Duplicate prevention.
- [ ] Indexes.

## 3.3 Groups
- [ ] Groups.
- [ ] Creator/owner.
- [ ] Group settings.

## 3.4 Group members
- [ ] Membership.
- [ ] Role if required.
- [ ] Duplicate prevention.
- [ ] Constraints.

## 3.5 Expenses
- [ ] Expense.
- [ ] Minor-unit amount.
- [ ] Currency.
- [ ] Payer.
- [ ] Group/friend context.
- [ ] Description/date/category.

## 3.6 Participants/allocations
- [ ] Participants.
- [ ] Split allocations.
- [ ] Constraints.

## 3.7 Settlements
- [ ] Settlement records.
- [ ] Amount/currency.
- [ ] Payer/payee.
- [ ] Idempotency reference where required.

## 3.8 Activity
- [ ] Activity events.
- [ ] Safe metadata.

## 3.9 Notifications
- [ ] Notification model if required.
- [ ] Read/unread state.

## 3.10 Attachments
- [ ] Attachment metadata only if in current scope.
- [ ] Parent resource.
- [ ] Storage reference.

### Gate
- [ ] Fresh database migration succeeds.
- [ ] Foreign keys work.
- [ ] Uniqueness constraints work.
- [ ] Important indexes exist.
- [ ] No sensitive fields are unnecessarily exposed.

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

## 4.1 Users
- [ ] Get current user.
- [ ] Update allowed profile fields.
- [ ] Validation.
- [ ] Authorization tests.

## 4.2 Friends
- [ ] Search permitted users.
- [ ] Create relationship.
- [ ] Remove if supported.
- [ ] Bilateral balance.
- [ ] Authorization tests.

## 4.3 Groups
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

## 4.4 Expenses
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

## 4.5 Balances
- [ ] Personal balance.
- [ ] Friend balance.
- [ ] Group balance.
- [ ] Simplified debts.

## 4.6 Settlements
- [ ] Create.
- [ ] Get.
- [ ] List.
- [ ] Validate.
- [ ] Transaction.
- [ ] Idempotency.

## 4.7 Activity
- [ ] List.
- [ ] Scope correctly.
- [ ] Pagination.

## 4.8 Uploads
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

- [ ] Configure production error monitoring.
- [ ] Remove sensitive data from reports.
- [ ] Add release/version metadata.
- [ ] Structured server logs.
- [ ] Request IDs.
- [ ] API/database health checks.
- [ ] Safe production error responses.

---

# PHASE 22 — Backup & Recovery

- [ ] Define database backup procedure.
- [ ] Test restoration.
- [ ] Document migration recovery.
- [ ] Document production incident recovery.
- [ ] Verify required file/receipt recovery.

---

# PHASE 23 — Android Release Candidate

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
