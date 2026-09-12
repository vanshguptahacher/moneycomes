# CLAUDE.md — Engineering & Claude Code Rules

**Project:** Production-grade expense-sharing mobile application  
**Primary platform:** Android first  
**Development model:** Small, sequential, validated phases  
**Product direction:** Splitwise-style core functionality with a cleaner, more modern, premium and easier UX

---

## 1. Purpose

This file defines the mandatory rules for Claude Code and any other coding agent working on this repository.

The objective is not to produce a quick prototype.

The objective is to build a **production-quality application from the beginning**, while keeping implementation incremental enough that every change can be tested and diagnosed independently.

The app must prioritize:

1. Financial correctness
2. Security
3. Data integrity
4. Reliability
5. Maintainability
6. Excellent mobile UX
7. Performance
8. Controlled dependency growth
9. Small, reversible implementation steps

Do not sacrifice correctness for speed.

---

# 2. Source-of-Truth Hierarchy

When project documents disagree, use this order:

1. `PRD.md` — product requirements and intended behavior
2. `PROJECT_SPEC.md` — implementation-facing product/technical contract
3. `SECURITY_SPEC.md` — security requirements
4. `UI_UX_SPEC.md` — UI/UX requirements
5. `ROADMAP.md` — phase and dependency order
6. `TASKS.md` — current implementation checklist
7. `TESTING.md` — verification requirements
8. `TROUBLESHOOTING.md` — diagnosis/recovery guidance
9. Existing source code — current implementation reality

If code conflicts with a documented requirement, do not silently change the requirement. Identify the conflict and resolve it deliberately.

---

# 3. Product Boundaries

## Phase 1 must provide

- Authentication
- Users
- Friends
- Groups
- Group members
- Expenses
- Equal splitting
- Exact splitting
- Percentage splitting
- Shares splitting
- Balances
- Debt simplification
- Settlements
- Expense history
- Activity
- Categories
- Currency handling
- Search/filtering where specified
- Account/settings
- Production-grade loading/error/empty states

## Phase 1 must NOT introduce

- AI
- AI receipt parsing
- AI financial assistant
- Advertising
- Ad SDKs
- UPI/payment automation
- Bank integrations
- Cryptocurrency
- Social-feed features
- Gamification
- Microservices
- Unnecessary infrastructure

The core expense-sharing experience must remain genuinely useful without requiring payment.

Future premium functionality is initially intended to support **ad removal only if advertising is introduced later**. Do not implement monetization infrastructure in Phase 1.

---

# 4. Development Philosophy

Follow:

```text
Understand
    ↓
Plan the smallest change
    ↓
Implement
    ↓
Typecheck / lint
    ↓
Run focused tests
    ↓
Run affected flow
    ↓
Review diff
    ↓
Update documentation/task status
    ↓
Only then continue
```

Never combine several unrelated features simply because they are convenient to implement together.

A smaller verified change is preferable to a large unverified change.

---

# 5. Small-Task Rule

Every implementation task should be small enough that a failure has an obvious likely cause.

Examples of good tasks:

- Add one database table
- Add one migration
- Add one API route
- Add one validation schema
- Add one accounting function
- Add one screen
- Add one mutation
- Add one test suite

Avoid tasks such as:

> "Build the complete expense system."

Break them into independently verifiable steps.

`TASKS.md` is the execution checklist.

Do not mark a task complete merely because code was written.

---

# 6. Architecture Rules

Use clear separation of responsibilities.

Preferred conceptual structure:

```text
UI
 ↓
Presentation / hooks
 ↓
Application services
 ↓
Domain logic
 ↓
Repository / API layer
 ↓
Database
```

The exact folder names may vary, but responsibilities must remain separated.

## UI must NOT

- perform authoritative financial calculations,
- contain database queries scattered across components,
- contain security decisions,
- directly mutate database state,
- duplicate server state unnecessarily.

## Domain layer must

- remain deterministic,
- be independently testable,
- contain financial rules,
- avoid React dependencies,
- avoid UI-specific assumptions.

## API/server layer must

- authenticate,
- authorize,
- validate,
- execute domain logic,
- perform transactional mutations,
- return safe errors.

---

# 7. Financial Logic Is Critical

This is a financial application.

Treat accounting logic as a high-risk domain.

Never implement balances casually inside screen components.

The authoritative flow should conceptually be:

```text
Expense
 ↓
Participants
 ↓
Split calculation
 ↓
Validated allocations
 ↓
Balance calculation
 ↓
Settlement effects
 ↓
Debt simplification
```

Every step must be deterministic.

---

# 8. Money Representation

Never use JavaScript floating-point numbers as the authoritative representation of money.

Use:

```text
integer minor units + currency code
```

Examples:

```text
₹100.00 → 10000 INR
₹100.50 → 10050 INR
```

The exact representation may be implemented with a dedicated money type/value object.

Formatting for display may convert values to strings/decimal representations, but storage and calculations must remain exact.

---

# 9. Financial Invariants

Every relevant test suite must preserve these invariants.

### Split total

```text
sum(all participant allocations) = expense total
```

### Percentage split

```text
sum(percentages) = 100%
```

subject to the documented precision rules.

### Shares

All shares must be valid and non-negative according to the product rules.

### Equal split

Remainders must be distributed deterministically.

The same input must always produce the same allocation.

### Settlement

A settlement must change the intended balance correctly and must not create impossible financial states.

### Transactionality

If one part of a financial mutation fails, the entire mutation must roll back.

### Recalculation

Balances derived from source records must be reproducible.

---

# 10. Database Rules

Use migrations for schema changes.

Never silently modify production schema manually.

Database requirements include:

- foreign keys,
- uniqueness constraints,
- appropriate indexes,
- non-null constraints where required,
- safe deletion/update behavior,
- transactional financial mutations.

Do not add indexes blindly.

Each important index should have a reason related to a known query pattern.

---

# 11. API Rules

All protected API operations must follow:

```text
Authentication
    ↓
Authorization
    ↓
Schema validation
    ↓
Business validation
    ↓
Domain operation
    ↓
Transaction
    ↓
Safe response
```

Never trust:

- client user IDs,
- client group membership claims,
- client-calculated balances,
- client-provided authorization information.

The server is authoritative.

Use versioned API routes where the project architecture requires them.

Do not scatter raw API calls across the application.

---

# 12. Authorization Rules

Authentication answers:

> "Who are you?"

Authorization answers:

> "Are you allowed to do this?"

Both are required.

Examples:

- A user may only access groups they belong to.
- A user cannot edit an unrelated user's expense.
- A user cannot remove arbitrary group members.
- A user cannot access another group's balances.
- Attachment access must be authorized against the parent resource.

Never rely only on hidden buttons or navigation guards.

Frontend restrictions are UX.

Server authorization is security.

---

# 13. Authentication & Sessions

Use the project's approved authentication system.

Do not create a custom password system.

Never:

- store plaintext passwords,
- log passwords,
- log session tokens,
- hard-code authentication secrets,
- expose secrets in client bundles.

Handle:

- session restoration,
- expiry,
- logout,
- protected routes,
- authentication errors,
- secure local session storage where applicable.

---

# 14. Validation

Validate at both boundaries:

### Client

For immediate UX.

### Server

For security and correctness.

Client validation can never replace server validation.

Use typed schemas for API inputs and important forms.

Examples:

- amount > 0,
- valid currency,
- valid payer,
- participants exist,
- participants belong to the correct group,
- split values are valid,
- exact allocations equal the total,
- percentages are valid,
- required fields exist.

---

# 15. Idempotency & Duplicate Mutations

Network failures can happen after the server commits but before the client receives the response.

Therefore important mutations must be designed so that retries do not accidentally create duplicate financial records.

Use an idempotency mechanism where appropriate.

Particularly important for:

- creating expenses,
- creating settlements,
- other financial mutations.

Never solve duplicate-record problems by merely hiding duplicates in the UI.

---

# 16. Error Handling

Errors must be classified appropriately.

Examples:

- validation error,
- authentication error,
- authorization error,
- not found,
- conflict,
- rate limit,
- server error,
- network failure.

Users should receive understandable messages.

Never expose:

- SQL errors,
- stack traces,
- secrets,
- internal paths,
- database details.

Use structured server errors and centralized error handling.

---

# 17. State Management

Use the selected state tools for their intended purposes.

## TanStack Query

Use for server state:

- groups,
- expenses,
- balances,
- members,
- settlements,
- activity,
- notifications.

## Zustand

Use for client/UI state:

- modal state,
- temporary UI preferences,
- selected filters,
- ephemeral interaction state.

Do not duplicate the complete server database inside Zustand.

Avoid multiple competing sources of truth.

---

# 18. Forms

Use the selected form and schema-validation tools.

Forms must:

- validate early,
- preserve user input on recoverable failure,
- show inline errors,
- use appropriate keyboards,
- prevent duplicate submission,
- clearly indicate saving state,
- handle server-side validation errors.

Expense creation must remain fast.

Do not add unnecessary steps.

---

# 19. UI/UX Rules

The application must feel:

- modern,
- premium,
- calm,
- intentional,
- distinctive,
- trustworthy,
- easy.

It must NOT feel like:

- a generic CRUD dashboard,
- a spreadsheet,
- an admin panel,
- a cluttered clone.

The user should understand the app without learning accounting terminology.

Prefer:

> "Rahul owes you ₹420"

over:

> "Net receivable: ₹420"

---

# 20. Mobile-First Rule

Android phone experience is the primary validation target.

Do not assume:

- one fixed screen width,
- large displays,
- unlimited vertical space,
- desktop-like interaction.

The app must handle:

- narrow phones,
- different aspect ratios,
- system insets,
- keyboard appearance,
- long names,
- large numbers,
- accessibility text scaling where practical.

No horizontal overflow.

No clipped critical information.

---

# 21. Premium Design Rules

Premium does not mean excessive decoration.

Use:

- strong typography,
- intentional spacing,
- excellent hierarchy,
- restrained color usage,
- subtle motion,
- consistent components,
- thoughtful empty states,
- polished feedback.

Avoid:

- random gradients,
- excessive shadows,
- excessive glass effects,
- excessive cards,
- inconsistent corner radii,
- arbitrary colors,
- unnecessary animations.

Do not use a generic template and simply change the primary color.

---

# 22. Add Expense UX

The Add Expense flow is a top-priority experience.

It should make common expenses quick to enter.

Use sensible defaults:

- current user as payer when appropriate,
- equal split,
- current date,
- recently relevant group.

But never hide important financial information.

The user must be able to review the resulting split before committing it.

---

# 23. Loading / Empty / Error / Success States

Every important screen must define:

### Loading

Use skeletons or meaningful progress indicators where appropriate.

### Empty

Explain what is missing and provide one clear next action.

### Error

Explain what happened and how to recover.

### Success

Give concise confirmation after meaningful mutations.

Example:

> Expense added ✓

Buttons performing mutations must prevent accidental double submission.

---

# 24. Accessibility

All important interactions should support:

- accessible labels,
- readable typography,
- sufficient contrast,
- comfortable touch targets,
- screen-reader semantics,
- keyboard-safe forms,
- information not conveyed by color alone.

Do not use color as the only indicator for owing/owed states.

---

# 25. Performance Rules

Do not optimize based on guesses.

First identify the bottleneck.

Avoid:

- unnecessary rerenders,
- unnecessary network requests,
- unbounded lists,
- duplicate server queries,
- expensive work during render.

Use pagination/virtualization where data size requires it.

Financial correctness always takes priority over micro-optimizations.

---

# 26. Expo / React Native Rules

The project uses Expo Prebuild / CNG.

Use Expo-compatible versions of native dependencies.

Prefer:

```bash
npx expo install <package>
```

for Expo-managed/native dependencies.

Do not blindly install:

```text
latest
```

for native packages.

Verify compatibility with the project's Expo SDK before installation.

---

# 27. Native Project Rules

The generated native project is not the primary source of application configuration.

Prefer configuration in:

- `app.json`
- `app.config.*`
- config plugins
- JavaScript/TypeScript source
- package configuration

Do not manually edit generated native files as the first solution to a build problem.

If a manual native customization is genuinely necessary, document why it exists and how it survives regeneration.

---

# 28. Future Native Module Protocol

If a new native module is required later, use this process:

```text
1. Identify requirement
       ↓
2. Check whether a native module is actually necessary
       ↓
3. Confirm Expo SDK compatibility
       ↓
4. Install using Expo-compatible workflow
       ↓
5. Configure plugin/app config
       ↓
6. Clean generated native output according to project policy
       ↓
7. Run Expo Prebuild
       ↓
8. Build Android
       ↓
9. Run smoke tests
       ↓
10. Run affected automated tests
       ↓
11. Document the dependency
```

The project must remain reproducible from JavaScript/configuration source.

The goal is:

> **Clean prebuild + build should succeed without undocumented manual native patches.**

If a native module cannot survive clean regeneration, treat that as a compatibility problem that must be resolved before merging.

---

# 29. Android Build Rules

For Android validation:

1. Use the project's locked Expo/RN baseline.
2. Do not manually mix Android templates from another SDK.
3. Do not randomly change Gradle/AGP versions.
4. Check JDK compatibility before changing Java versions.
5. After native dependency changes, regenerate and rebuild.
6. Run the core smoke test after a successful build.

The release build must be reproducible.

---

# 30. Dependency Discipline

Before adding a dependency, answer:

1. Is it actually necessary?
2. Can the current stack solve it?
3. Is it compatible with the Expo/RN version?
4. Does it require native code?
5. Does it increase build risk?
6. Does it increase security surface?
7. Is it maintained?
8. Is its bundle/runtime cost justified?

Do not introduce dependencies merely for convenience.

Never upgrade the entire dependency tree to fix one isolated problem.

---

# 31. Environment Management

Keep environments separate.

At minimum, distinguish:

```text
development
test
production
```

Never commit production secrets.

Use safe examples:

```text
.env.example
```

with placeholders only.

Never place secrets in:

- source code,
- Git commits,
- screenshots,
- logs,
- client-visible configuration.

---

# 32. Logging & Observability

Production errors must be diagnosable.

Use structured logs/request IDs where applicable.

Never log:

- passwords,
- auth tokens,
- cookies,
- secrets,
- private credentials,
- unnecessary personal data.

Do not use production logs as a dumping ground for full database objects.

---

# 33. Testing Rules

At minimum, financial logic requires unit tests.

Important layers:

```text
Domain unit tests
        ↓
API integration tests
        ↓
Component tests
        ↓
E2E tests
        ↓
Android build/smoke tests
```

A financial feature is not complete without tests for:

- normal cases,
- edge cases,
- invalid cases,
- rounding,
- authorization,
- failure/retry behavior where relevant.

---

# 34. Regression Rule

After changing a core financial function, run:

- the focused unit tests,
- all related accounting tests,
- affected API tests,
- affected mobile flow,
- full financial regression before release.

Do not assume a small accounting change is isolated.

---

# 35. Git Rules

Use Git from the beginning.

Prefer focused commits.

Examples:

```text
feat(auth): add session restoration
feat(groups): add group creation
feat(expenses): add equal split
fix(balance): correct remainder allocation
test(accounting): cover percentage rounding
```

Do not mix:

```text
UI redesign + database migration + unrelated refactor
```

in one commit unless unavoidable.

---

# 36. Refactoring Rules

Refactor when it improves correctness or maintainability.

Do not refactor unrelated code while implementing a feature.

Avoid:

- speculative abstractions,
- generic frameworks for one use,
- premature design patterns,
- unnecessary architecture layers.

The architecture should be extensible, not over-engineered.

---

# 37. Security Before Release

Before production release, verify:

- authentication,
- session handling,
- authorization,
- IDOR protection,
- input validation,
- financial invariants,
- rate limiting,
- upload restrictions,
- secret management,
- HTTPS,
- database exposure,
- error leakage,
- dependency vulnerabilities,
- logging privacy.

Any critical security defect blocks release.

---

# 38. Financial Defect Policy

Any issue that can cause:

- incorrect balance,
- incorrect split,
- incorrect settlement,
- duplicate financial mutation,
- unauthorized financial access,
- data loss,

is a **release blocker** until resolved and tested.

Do not ship a known financial-integrity defect.

---

# 39. Scope Control

When asked to add a new feature:

1. Check `PRD.md`.
2. Determine whether it belongs to the current phase.
3. Check dependencies.
4. Do not silently expand Phase 1.
5. If it is a future feature, record it for the appropriate roadmap/task phase.

Do not add AI, ads, UPI, analytics, or other future features merely because they could be useful later.

---

# 40. When Something Fails

Do not guess.

Follow:

```text
Read the complete error
        ↓
Identify the failing layer
        ↓
Reproduce
        ↓
Check recent changes
        ↓
Make one targeted change
        ↓
Validate
```

For native build errors, first inspect:

- Expo SDK,
- React Native version,
- native dependency compatibility,
- config plugins,
- JDK,
- Gradle/AGP generated by the current Expo baseline.

Do not randomly upgrade/downgrade multiple packages.

See `TROUBLESHOOTING.md` for detailed recovery procedures.

---

# 41. Documentation Rules

Update documentation when changing:

- product behavior,
- architecture,
- security assumptions,
- database schema,
- native dependencies,
- build process,
- testing requirements.

Do not allow the documentation to describe an architecture that no longer exists.

---

# 42. Definition of Done

A task is complete only when all applicable requirements are satisfied:

- [ ] Intended behavior implemented
- [ ] Types pass
- [ ] Lint passes
- [ ] Relevant tests pass
- [ ] Error state handled
- [ ] Loading state handled
- [ ] Empty state handled
- [ ] Success feedback handled
- [ ] Authorization verified
- [ ] Financial invariants verified
- [ ] No accidental scope creep
- [ ] Android tested when applicable
- [ ] Native clean prebuild tested when native dependencies changed
- [ ] Documentation updated when necessary
- [ ] Git diff reviewed

---

# 43. Final Rule

When uncertain, prefer:

> **Simple + explicit + typed + tested + secure**

over:

> **Fast + clever + complicated**

The app should eventually feel simple to the user because the engineering underneath it is disciplined—not because complexity was ignored.
