# SECURITY.md — Production Security Specification

## 1. Security Objective

The application handles personal and financial relationship data. Security is a release requirement, not a later enhancement.

Protect:

- user accounts and sessions
- groups and memberships
- expenses and split information
- balances and settlements
- receipts and uploaded files
- API/database infrastructure
- secrets and operational data

## 2. Security Principles

1. Never trust the client.
2. Authenticate every protected operation.
3. Authorize every protected resource.
4. Validate every external input.
5. Keep financial calculations deterministic and server-authoritative.
6. Use transactions for financial mutations.
7. Minimize collected and exposed data.
8. Never log secrets or sensitive credentials.
9. Fail safely.
10. Prefer explicit security boundaries over hidden assumptions.

## 3. Authentication

Use **Better Auth** as the approved authentication and session-management implementation. Better Auth is persisted in the application's Supabase PostgreSQL database and is exposed to the mobile app only through the Hono API boundary. Do not introduce Supabase Auth as a second authentication system unless the architecture is explicitly re-approved.

Requirements:

- passwords must never be stored in plaintext
- authentication secrets must never be committed
- sessions must be securely managed
- logout must invalidate the applicable session
- expired/invalid sessions must not access protected resources
- protected mobile routes must not be treated as the security boundary
- authentication failures must not expose unnecessary account information

Never implement an ad-hoc password hashing/session system unless explicitly approved.

## 4. Authorization

Authentication proves identity. Authorization proves permission.

Every resource must be checked server-side.

Examples:

- a user can access only groups they are permitted to access
- group membership must be verified before reading group financial data
- only permitted users can modify group membership
- expense access must be authorized against its group/friend context
- settlement access must be authorized
- attachment access must be authorized against its parent resource

Do not rely on:

- hidden buttons
- disabled UI controls
- navigation guards
- client-side user IDs

## 5. IDOR Protection

Every endpoint accepting an identifier must verify that the authenticated user is allowed to access that identifier.

Bad:

```text
GET /expenses/:id
→ query expense by ID
→ return result
```

Correct:

```text
authenticate
→ authorize access to expense context
→ query/return permitted resource
```

Do not assume that an opaque UUID alone provides authorization.

## 6. Input Validation

Validate on the server even if the mobile app already validates.

Validate:

- request body
- query parameters
- route parameters
- enums
- IDs
- amounts
- currencies
- participants
- split values
- dates
- pagination
- uploaded files

Reject malformed input early.

Use typed schemas.

## 7. Financial Security

Financial state is authoritative on the server.

Never accept a client-calculated balance as truth.

Never allow a client to arbitrarily submit:

```text
balance = 5000
```

Instead submit the underlying valid operation:

```text
expense
participants
payer
split
```

and calculate the financial result server-side.

## 8. Money Representation

Use integer minor units plus currency.

Example:

```text
₹100.50 → 10050 INR
```

Never use JavaScript floating-point values as the authoritative representation.

## 9. Financial Invariants

Every financial operation must preserve:

- split total equals expense total
- percentage totals follow documented rules
- exact allocations equal the expense total
- valid shares are non-negative
- rounding is deterministic
- settlement effects are correct
- unauthorized users cannot modify financial records
- failed transactions leave no partial state

## 10. Transactions

Financial mutations must be atomic.

Conceptual flow:

```text
Authenticate
→ Authorize
→ Validate
→ Calculate
→ Begin transaction
→ Write financial records
→ Write related activity
→ Commit
```

If any step fails:

```text
Rollback
```

Do not allow partial expense/participant/settlement records.

## 11. Idempotency

Network retries can happen after the server commits but before the client receives a response.

Important financial mutations should support an idempotency strategy.

At minimum consider:

- create expense
- create settlement
- other retry-sensitive mutations

A repeated request must not silently create duplicate financial records.

## 12. API Security

Use:

- HTTPS in production
- structured validation
- authentication middleware
- authorization middleware
- centralized error handling
- request IDs
- rate limiting
- safe response schemas

Do not expose:

- stack traces
- SQL errors
- database credentials
- internal file paths
- secrets
- session tokens

## 13. Rate Limiting

Apply appropriate limits to:

- login/authentication attempts
- password recovery
- user search
- invitations
- expensive operations
- uploads
- repeated financial mutations
- suspicious traffic

Rate limits must not create a way to enumerate valid users.

## 14. Database Security

The current production database is **Supabase PostgreSQL**. The mobile application must never connect directly to PostgreSQL; database access is server-side through the Hono API and Drizzle.

- Database must not be publicly exposed unnecessarily.
- Use least-privilege credentials.
- Use parameterized/ORM queries.
- Never concatenate untrusted SQL.
- Use foreign keys and constraints.
- Use migrations for schema changes.
- Restrict production database access.

## 15. Secrets

Never commit:

- database passwords
- authentication secrets
- signing keys
- API keys
- storage credentials
- production tokens

Use environment/secrets management.

Safe example files may contain placeholders only.

## 16. File Upload Security

The current attachment provider is **Supabase Storage**, accessed through the Hono API. Storage credentials must remain server-side.

If receipts/files are supported:

- require authentication
- verify authorization against the parent resource
- enforce size limits
- validate MIME type
- validate file signatures where practical
- generate safe object names
- prevent path traversal
- use controlled/signed access
- never make storage publicly writable
- consider malware scanning for production

Never trust a filename extension as proof of file type.

## 17. Privacy

Collect only information needed for the product.

Do not expose another user's private information unnecessarily.

Do not add advertising trackers in Phase 1.

Do not sell user financial/activity data.

Sensitive data should not appear in analytics or debug logs.

## 18. Logging

Logs should help diagnose production failures without becoming a source of data leakage.

Never log:

- passwords
- auth tokens
- cookies
- secrets
- private credentials
- complete sensitive financial objects unless strictly necessary

Use request IDs for correlation.

## 19. Mobile Security

The mobile client is untrusted.

Never place server secrets in the Android application.

Use secure device storage for sensitive session-related data where required.

Do not assume APK extraction is impossible.

Anything shipped to the client should be treated as potentially observable.

## 20. Expo / Native Security

Native dependencies must be reviewed before adoption.

Before adding a native module:

- verify source/package authenticity
- verify Expo compatibility
- review permissions
- review Android permissions added by the package
- understand native code behavior
- avoid abandoned packages

Do not add native modules solely for convenience.

## 21. Android Permissions

Request the minimum permissions necessary.

Do not request:

- contacts access
- location
- microphone
- camera
- storage
- notifications

unless a real product requirement exists.

Explain permission-dependent functionality clearly to users.

## 22. Abuse Cases

Threat-model at least:

- brute-force login
- account enumeration
- IDOR
- unauthorized group access
- forged payer
- forged participants
- settlement replay
- duplicate expense creation
- malicious uploads
- oversized payloads
- rate-limit abuse
- stale-session access
- privilege escalation

## 23. Infrastructure Security

The current production boundary is:

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

Requirements:

- Cloudflare Workers is the current API hosting boundary.
- Hono is the application/API security boundary.
- Supabase PostgreSQL is authoritative for relational application data.
- Supabase Storage is used for receipts/attachments.
- Privileged database, authentication, and storage credentials remain server-side.
- Production traffic uses HTTPS.
- Provider-specific credentials must be stored using deployment secrets/environment configuration.
- Do not add Oracle Cloud VMs, Caddy, self-hosted PostgreSQL, or Oracle Object Storage without an explicit architecture decision.
- Local PostgreSQL may be used for isolated development/testing; it is not production authority.

## 24. Security Testing

Before release:

- authentication tests
- session tests
- authorization matrix tests
- IDOR tests
- input validation tests
- rate-limit tests
- upload tests
- financial invariant tests
- dependency audit
- production configuration review

## 25. Security Incident Rule

If a suspected security defect affects user data, authentication, authorization, or financial integrity:

1. stop the affected release
2. reproduce safely
3. determine scope
4. fix the root cause
5. add a regression test
6. review related attack paths
7. document the resolution

Do not hide security failures by suppressing errors.

## 26. Release Gate

A critical security defect blocks release.

Security must be reviewed before the first public production release and again whenever authentication, authorization, storage, financial mutations, or infrastructure changes materially.
