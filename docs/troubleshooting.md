# TROUBLESHOOTING.md — Development, Expo, Android & Production Recovery

## 1. General Debugging Rule

Never change five things at once.

Use:

```text
Read complete error
→ Identify failing layer
→ Reproduce
→ Make one targeted change
→ Validate
→ Document if needed
```

The latest error message is not always the root cause. Check the first meaningful failure in the log.

---

# 2. Layer Identification

First determine whether the failure belongs to:

```text
Editor / TypeScript
        ↓
Metro / JavaScript
        ↓
Expo configuration
        ↓
Native dependency
        ↓
Gradle / Android
        ↓
API
        ↓
Database
        ↓
Authentication
        ↓
Production infrastructure
```

Do not troubleshoot the database when the app cannot compile.

---

# 3. TypeScript Errors

Check:

- actual compiler error
- incorrect imports
- stale types
- null/undefined handling
- API response mismatch
- generated types

Do not solve type errors with broad `any`.

If an API shape is wrong, fix the source contract.

---

# 4. Metro / Bundler Problems

Symptoms:

- module not found
- stale bundle
- unexpected runtime code
- resolver errors

Try:

1. stop Metro
2. restart with cache clearing
3. verify package installation
4. verify import path
5. verify Expo-compatible package version

Do not immediately upgrade Expo.

---

# 5. Expo Dependency Problems

Before installing a package:

- check Expo SDK compatibility
- prefer `npx expo install`
- inspect peer dependencies
- determine whether it requires native code

Avoid:

```text
npm install package@latest
```

when the package has native dependencies and compatibility is uncertain.

---

# 6. Expo Prebuild Failure

Check:

- Expo SDK version
- app configuration
- config plugins
- native package compatibility
- malformed configuration
- environment variables

For a clean regeneration:

```text
Verify JS/config source
→ Remove generated native output according to repository policy
→ Run Expo Prebuild
→ Inspect output
→ Build Android
```

Generated files must not be patched randomly.

---

# 7. Native Module Problems

If a new native package causes a failure:

1. confirm package compatibility
2. inspect its config plugin
3. verify required Android permissions
4. check package installation method
5. perform clean prebuild
6. rebuild
7. test the affected feature

If clean prebuild fails, the project must not rely on an undocumented manual native patch.

---

# 8. Android Gradle Errors

Determine whether the issue is:

- JDK
- Gradle
- Android Gradle Plugin
- Android SDK
- dependency resolution
- native module
- application source

Use versions compatible with the current Expo/RN baseline.

Do not randomly change:

- Gradle version
- AGP version
- Kotlin version
- compile SDK

unless the current toolchain requires it.

---

# 9. JDK / Java Problems

If Android tooling reports a Java compatibility issue:

1. check the required JDK for the current Expo/RN/Gradle baseline
2. check the active `JAVA_HOME`
3. verify CI uses the same expected JDK
4. avoid changing the application architecture to solve a local JDK mismatch

Prefer a stable LTS JDK for reproducible CI when supported by the project baseline.

---

# 10. Android Build Works Locally but Not in CI

Compare:

- Node version
- package lock
- Java/JDK
- Android SDK
- environment variables
- build profile
- Expo CLI version
- native generated output

Do not assume local machine configuration is part of the repository.

---

# 11. Authentication Failures

Check:

- API URL
- HTTPS
- auth configuration
- auth secret
- session persistence
- cookie/session transport
- server clock if relevant
- protected-route middleware
- mobile secure storage

Never print session tokens to logs.

---

# 12. Database Connection Failure

Check in order:

1. database availability
2. environment variables
3. credentials
4. network connectivity
5. migration status
6. schema version
7. connection pool/configuration

Do not modify schema manually to hide a migration problem.

---

# 13. Migration Failure

If a migration fails:

1. read the exact failing SQL/error
2. determine whether the migration is safe to retry
3. inspect migration state
4. fix the migration
5. test against a fresh database
6. test against a database representing the expected previous version

Never delete production migration history casually.

---

# 14. Expense Calculation Bug

Never patch the displayed balance first.

Trace:

```text
Input
→ Validation
→ Split engine
→ Stored allocations
→ Balance engine
→ Settlement effects
→ API response
→ UI
```

Reproduce with a deterministic fixture.

Test:

- equal split
- exact split
- percentage
- shares
- rounding
- many participants
- small amounts
- large amounts

Check financial invariants.

---

# 15. Balance Bug

Recalculate from source records.

Check:

- payer
- participants
- allocations
- settlements
- currency
- sign/direction
- rounding
- duplicate records

Do not manually alter a balance record if balances are derived values.

---

# 16. Duplicate Expense / Settlement

Likely causes:

- retry after timeout
- double tap
- mutation replay
- missing idempotency
- client state race

Check server behavior first.

Do not hide duplicates with UI filtering.

---

# 17. Network Failure

A mutation may have:

```text
Not sent
Sent but failed
Committed but response lost
Confirmed
```

The UI must not assume "no response" means "not committed."

Use idempotency/reconciliation where required.

---

# 18. UI Loading Issues

Check:

- query keys
- invalidation
- duplicate requests
- stale state
- mutation state
- navigation lifecycle

Do not add arbitrary delays such as:

```text
setTimeout(..., 1000)
```

to hide synchronization problems.

---

# 19. Keyboard / Form Problems

Check:

- keyboard-aware container
- scroll behavior
- input focus
- bottom inset
- Android keyboard resize behavior
- numeric keyboard
- submit behavior

Never let the keyboard cover the primary action.

---

# 20. Screen Overflow

Test narrow Android phones.

Check:

- fixed widths
- long group names
- long usernames
- large currency amounts
- large text settings
- nested horizontal containers

Prefer flexible layouts.

---

# 21. Performance Problems

Measure first.

Look for:

- unnecessary rerenders
- duplicate API calls
- unbounded lists
- large objects passed through props
- expensive calculations during render

Move expensive deterministic calculations to appropriate domain/service layers.

---

# 22. Production API Failure

Use request IDs to correlate:

```text
Mobile error
→ Request ID
→ Server logs
→ Database/API operation
```

Do not expose internal errors to the user.

Show a useful recovery message.

---

# 23. Upload Failure

Check:

- authentication
- authorization
- file size
- MIME type
- storage credentials
- object key
- signed URL
- expiry
- network connectivity

Do not make the entire storage bucket publicly writable as a quick fix.

---

# 24. Native Module Added Later

Required recovery sequence:

```text
1. Confirm requirement
2. Confirm package compatibility
3. Install with Expo-compatible command
4. Configure plugin
5. Clean generated native output
6. Run Expo Prebuild
7. Build Android
8. Install/launch
9. Test native feature
10. Run regression tests
```

If it fails, isolate the native package before changing unrelated dependencies.

---

# 25. Clean Rebuild Philosophy

The repository should be capable of reconstructing the native project from:

- package configuration
- Expo configuration
- config plugins
- source code

A successful manual build that fails after clean prebuild is not considered a stable solution.

---

# 26. Git Recovery

Before risky changes:

- inspect `git status`
- inspect recent commits
- understand local modifications

Do not discard user work.

Avoid:

```text
git reset --hard
```

unless explicitly requested and the consequences are understood.

---

# 27. Dependency Recovery

If a dependency update breaks the project:

1. identify the package
2. inspect the lockfile diff
3. check Expo compatibility
4. reproduce
5. revert the smallest relevant change if necessary

Do not upgrade the whole project to fix one dependency.

---

# 28. Security Failure

If an error suggests:

- unauthorized access
- token leakage
- IDOR
- secret exposure
- financial manipulation

stop normal feature development.

Treat it as a security issue.

Add a regression test after fixing it.

---

# 29. Documentation Rule

If a recurring issue required a non-obvious solution, add a concise entry here.

Do not document random one-off mistakes as permanent architecture.

---

# 30. Final Recovery Principle

The goal is not merely:

> "Make it work."

The goal is:

> **"Make it reproducibly work for the next developer, next build, and next deployment."**
