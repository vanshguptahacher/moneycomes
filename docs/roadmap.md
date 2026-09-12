# ROADMAP.md — Incremental Product & Engineering Roadmap

## 1. Roadmap Philosophy

The application will be built in **small phases and smaller sub-phases**.

The objective is to minimize:

- implementation errors
- debugging scope
- regressions
- native build failures
- accidental architecture drift

Do not implement an entire large feature in one step.

## Infrastructure & Hosting Baseline (Locked)

The current production baseline is managed-service and free-first:

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

Rules:

- The mobile app never connects directly to PostgreSQL.
- Supabase PostgreSQL is the authoritative relational database.
- Better Auth remains the authentication/session system. Do not introduce Supabase Auth unless explicitly approved.
- Supabase Storage is the current attachment/receipt storage provider.
- Cloudflare Workers is the current production host for the Hono API.
- Local PostgreSQL may be used for development and automated tests; deployed environments use Supabase PostgreSQL.
- Provider-specific integrations must stay behind application/service boundaries where practical.
- Free-tier quotas are infrastructure constraints, not artificial product limits.
- Oracle Cloud, self-hosted PostgreSQL, Caddy, and Oracle Object Storage are not required for the current deployment baseline.

Do not replace this architecture or add a second production database/storage provider without an explicit architecture decision.

---

## 2. High-Level Sequence

```text
Phase 0  → Repository & Build Foundation
Phase 1  → Backend Foundation
Phase 2  → Financial Domain Engine
Phase 3  → Database Model
Phase 4  → API Resources
Phase 5  → Mobile Foundation
Phase 6  → Core Product Flows
Phase 7  → Premium UI/UX Refinement
Phase 8  → Resilience & Production Hardening
Phase 9  → Release Candidate
```

---

# Phase 0 — Repository & Android Build Foundation

## 0.1 Repository Audit

- inspect existing project
- remove stale unrelated project references
- confirm source-of-truth documentation
- confirm package manager
- confirm Node version
- confirm Expo SDK
- confirm React Native version

### Exit gate

Repository structure and technology baseline are known and documented.

## 0.2 Expo Baseline

- verify Expo configuration
- verify Expo Router
- verify Android project generation
- run development build
- verify application launches

### Exit gate

A clean Android build launches successfully.

## 0.3 Engineering Baseline

- TypeScript
- ESLint
- formatting
- test runner
- environment validation
- error handling baseline

### Exit gate

All baseline checks pass.

---

# Phase 1 — Backend Foundation

## 1.1 Server Bootstrap

- server entry point
- environment validation
- health endpoint
- centralized error handling
- request ID

## 1.2 Database Bootstrap

- PostgreSQL connection
- Supabase PostgreSQL production configuration
- Drizzle configuration
- migration system
- database health check
- local PostgreSQL development/test configuration

## 1.3 Authentication

- Better Auth configuration
- session handling
- protected route middleware
- authentication tests

### Exit gate

A signed-in user can safely access a protected endpoint.

---

# Phase 2 — Financial Domain Engine

This is one of the highest-risk phases.

## 2.1 Money

- minor-unit representation
- currency type
- arithmetic helpers
- formatting

## 2.2 Equal Split

- equal calculation
- deterministic remainder handling
- edge cases

## 2.3 Exact Split

- exact allocations
- total validation
- edge cases

## 2.4 Percentage Split

- percentage validation
- rounding
- total reconciliation

## 2.5 Shares Split

- share validation
- proportional calculation
- deterministic rounding

## 2.6 Balances

- payer/borrower relationships
- bilateral balance
- group net balances

## 2.7 Debt Simplification

- reduce unnecessary transfers
- preserve total net position
- deterministic result

## 2.8 Settlement

- settlement effect
- validation
- balance recalculation

### Exit gate

Financial unit tests and invariants pass.

---

# Phase 3 — Database Model

Build and migrate one logical area at a time.

## 3.1 Identity

- users
- profiles

## 3.2 Relationships

- friendships
- friend status

## 3.3 Groups

- groups
- group members
- group roles

## 3.4 Expenses

- expenses
- participants
- split allocations

## 3.5 Settlements

- settlement records

## 3.6 Activity

- activity records

## 3.7 Optional Attachments

- attachment metadata
- storage references

### Exit gate

A fresh database can be created entirely through migrations and all important constraints are enforced.

---

# Phase 4 — API Resources

Implement resources separately.

Order:

1. users
2. friends
3. groups
4. expenses
5. balances
6. settlements
7. activity
8. notifications
9. uploads

For each resource:

```text
Route
→ Schema
→ Auth
→ Authorization
→ Service
→ Domain logic
→ Database
→ Error handling
→ Tests
```

### Exit gate

Each resource has happy-path, validation, authorization, and failure tests.

---

# Phase 5 — Mobile Foundation

## 5.1 App Shell

- route groups
- authentication routes
- protected routes
- navigation

## 5.2 API Client

- base URL
- authentication
- typed responses
- error normalization

## 5.3 State

- TanStack Query
- Zustand
- loading/error handling

## 5.4 Shared UI

- Button
- Input
- Card
- Avatar
- Badge
- Modal
- Bottom sheet
- Toast
- Skeleton
- Empty state

### Exit gate

User can authenticate, navigate, sign out, and recover from a basic network failure.

---

# Phase 6 — Core Product

Implement in small screen-level sub-phases.

## 6.1 Home

- net position
- owes/owed
- recent groups
- recent activity
- quick add expense

## 6.2 Groups

- group list
- create group
- group detail
- members

## 6.3 Friends

- friend list
- friend detail
- bilateral balance

## 6.4 Add Expense

- amount
- description
- payer
- participants
- split type
- split editor
- review
- save

## 6.5 Expense Detail

- view
- edit
- delete where supported
- activity impact

## 6.6 Balances

- group balances
- simplified debts
- explanation

## 6.7 Settle Up

- outstanding amount
- settlement amount
- confirmation
- resulting balance

## 6.8 Activity

- chronological events
- useful filters

## 6.9 Account

- profile
- settings
- logout
- relevant preferences

### Exit gate

A complete real-world flow works:

```text
Create account
→ Create group
→ Add members
→ Add expense
→ Verify split
→ Verify balances
→ Settle
→ Verify final state
```

---

# Phase 7 — UX & Premium Visual Refinement

The application should now be functionally stable.

Redesign in this order:

1. Add Expense
2. Home
3. Group Detail
4. Balances
5. Settle Up
6. Friends
7. Activity
8. Account

Requirements:

- premium visual language
- distinctive color palette
- clear hierarchy
- fast interactions
- excellent empty/loading/error states
- accessible controls
- responsive phone layouts
- no generic CRUD appearance

### Exit gate

UX review passes without changing financial behavior.

---

# Phase 8 — Production Hardening

## 8.1 Reliability

- retry behavior
- idempotency
- stale data handling
- network failure recovery
- offline-safe drafts/cache where supported

## 8.2 Security

- authorization audit
- IDOR audit
- rate limiting
- upload hardening
- secret review
- dependency audit

## 8.3 Observability

- structured logs
- request IDs
- error monitoring
- safe production diagnostics

## 8.4 Data Protection

- Supabase PostgreSQL backup/recovery procedure
- Supabase Storage protection/recovery procedure
- migration recovery procedure
- disaster recovery documentation
- verify the actual backup/restore capabilities of the selected production tier

## 8.5 Performance

- startup
- lists
- queries
- rendering
- unnecessary refetches

## 8.6 Production Deployment

Deploy the API using the locked provider baseline.

- [ ] Configure Cloudflare Workers deployment.
- [ ] Configure production environment variables/secrets.
- [ ] Configure the Hono API for the Workers runtime.
- [ ] Configure the Supabase PostgreSQL connection.
- [ ] Configure Supabase Storage for private attachments.
- [ ] Configure Better Auth against the production PostgreSQL database.
- [ ] Run production database migrations safely.
- [ ] Verify API health/readiness behavior.
- [ ] Verify HTTPS and production CORS/origin rules.
- [ ] Verify rate limits and abuse controls where required.
- [ ] Run production smoke tests.
- [ ] Document rollback/recovery steps.

### Exit gate

No known critical security, data-integrity, or financial defects.

---

# Phase 9 — Release Candidate

## 9.1 Production Environment Verification

Before the final Android release build, verify the deployed backend and managed services:

- [ ] Cloudflare Workers API is reachable over HTTPS.
- [ ] Supabase PostgreSQL connectivity is healthy.
- [ ] Supabase Storage upload/access rules are working.
- [ ] Better Auth sign-in/session flows work against production.
- [ ] No production secrets are embedded in the mobile app.

## 9.2 Clean Build

Run the Android build from a clean state.

## 9.3 Regression

Run:

- unit tests
- financial invariant tests
- API integration tests
- component tests
- E2E tests
- Android smoke tests

## 9.4 Security Review

Complete the security checklist.

## 9.5 UX Review

Check:

- small phone
- long names
- large amounts
- keyboard
- accessibility
- empty states
- errors
- slow network

## 9.6 Release Gate

Release only when:

- critical tests pass
- clean Android build passes
- financial calculations are verified
- security review passes
- no known critical defect remains

---

# Future Native Module Protocol

Whenever a native module is added:

```text
Need identified
→ Check whether native module is necessary
→ Check Expo SDK compatibility
→ Install compatible package
→ Configure plugin/app config
→ Clean generated native output
→ Expo Prebuild
→ Android build
→ Smoke test
→ Automated tests
→ Commit
```

The repository must remain reproducible through source/configuration.

Do not depend on undocumented manual edits to generated Android files.

---

# Future Product Phases

After Phase 1 core stability, possible future work includes:

- receipt scanning
- offline-first synchronization
- recurring expenses
- advanced export
- advanced analytics
- notifications/reminders
- UPI/payment integrations
- premium/ad-removal infrastructure
- additional platforms

These must not leak into Phase 1 without an explicit scope decision.
