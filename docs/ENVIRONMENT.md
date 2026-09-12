# Backend Configuration & Environment Architecture

This document establishes the environment variable architecture, security boundaries, classification matrix, and setup procedures for the MoneyComes application.

---

## 1. Supported Environments

MoneyComes strictly distinguishes three runtime environments via `NODE_ENV`:

| Environment | Purpose | Database | Auth Secret | CORS Policy | Hosting / Platform |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `development` | Local workstation development and debugging. | Local PostgreSQL (`localhost:5432` or Docker Compose) | Pre-configured safe dev secret | Defaults to local Web & Expo ports (`3000`, `8081`) | Local Node runtime (`tsx`) |
| `test` | Automated test runner (Vitest, CI). | Isolated test database or mocks | Deterministic test secret | Permissive test defaults | Vitest test runner |
| `production` | Production deployment. | Supabase PostgreSQL (managed remote, fail-fast on localhost) | Strong random secret (min 32 chars, fail-fast on placeholders) | Strict explicit origin whitelist (wildcard `*` rejected) | Cloudflare Workers (Hono API) |

---

## 2. Environment Variable Classification Matrix

All backend configuration is centralized and validated in `server/config/index.ts` using Zod.

| Variable Name | Classification | Target Runtime | Default Value | Description & Constraints |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | OPTIONAL | Server | `development` | Runtime mode: `development`, `production`, or `test`. |
| `PORT` | OPTIONAL | Server (Local) | `3000` | Port for HTTP server binding in local Node development (integer `1..65535`). |
| `HOST` | OPTIONAL | Server (Local) | `0.0.0.0` | Network interface binding address for local Node development. |
| `DATABASE_URL` | REQUIRED (Prod)<br>OPTIONAL (Dev) | Server (SECRET) | `postgresql://postgres:postgres@localhost:5432/moneycomes` | PostgreSQL connection string. Must start with `postgresql://` or `postgres://`. In production, points to Supabase PostgreSQL (transaction pooler on port 6543 or direct on port 5432). Pointing to `localhost` or `127.0.0.1` triggers an immediate fail-fast error in production. |
| `BETTER_AUTH_SECRET` | REQUIRED (Prod)<br>OPTIONAL (Dev) | Server (SECRET) | Dev placeholder (32+ chars) | Cryptographic signing secret for Better Auth sessions and tokens (minimum 32 characters). In production, default placeholders trigger an immediate fail-fast error. |
| `BETTER_AUTH_URL` | REQUIRED (Prod)<br>OPTIONAL (Dev) | Server (SECRET) | `http://localhost:3000` | Canonical base URL for Better Auth authentication callbacks and origin checks. Must be a valid absolute URL. Localhost is rejected in production. |
| `TRUSTED_ORIGINS` | OPTIONAL | Server | Local dev ports (`3000`, `8081`) | Comma-separated list of origins trusted by Better Auth. Wildcards are rejected in production. |
| `CORS_ORIGIN` | REQUIRED (Prod)<br>OPTIONAL (Dev) | Server | Local dev ports (`3000`, `8081`) | Allowed origins for cross-origin browser requests. Because credentialed cookies/headers are supported, wildcard `*` is strictly forbidden in production. |
| `SUPABASE_URL` | REQUIRED (Prod)<br>OPTIONAL (Dev) | Server (SECRET) | Placeholder in `.env.example` | Canonical base URL of the Supabase project (e.g. `https://[PROJECT-REF].supabase.co`). Used by Hono API for Supabase Storage. |
| `SUPABASE_SERVICE_ROLE_KEY` | REQUIRED (Prod)<br>OPTIONAL (Dev) | Server (SECRET) | Placeholder in `.env.example` | Privileged service-role key for backend access to Supabase Storage. **STRICTLY SERVER-ONLY**: never ship to mobile client or prefix with `EXPO_PUBLIC_`. |
| `SUPABASE_STORAGE_BUCKET` | OPTIONAL | Server | `attachments` | Bucket name for expense receipt/invoice attachments in Supabase Storage. |
| `POSTGRES_USER` | DEV-ONLY | Server / Docker | `postgres` | Username for local PostgreSQL Docker container. |
| `POSTGRES_PASSWORD` | DEV-ONLY (SECRET) | Server / Docker | `postgres` | Password for local PostgreSQL Docker container. |
| `POSTGRES_DB` | DEV-ONLY | Server / Docker | `moneycomes` | Database name for local PostgreSQL Docker container. |
| `EXPO_PUBLIC_API_URL` | CLIENT-SAFE | Mobile App (Expo) | `http://10.0.2.2:3000` | Public base URL accessed by the React Native client. In production, points to the Cloudflare Workers API URL (e.g. `https://api.moneycomes.app`). |

---

## 3. Secret Separation & Client Safety Rules

1. **Server Secrets Must Never Enter Client Code**:
   - `DATABASE_URL`, `BETTER_AUTH_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`, and private API tokens are **strictly server-only**.
   - Expo statically bakes any environment variable prefixed with `EXPO_PUBLIC_` into client JavaScript bundles.
   - **Rule**: Never prefix a server secret or service role key with `EXPO_PUBLIC_`.
   - **Rule**: Mobile client never connects directly to PostgreSQL or Supabase Storage; all requests flow through the Hono API over HTTPS.
   - **Rule**: Never return database URLs, storage keys, system paths, or secrets in API responses or HTTP error envelopes.

2. **Source Control Hygiene**:
   - `.env`, `.env.production`, `.env.local`, and any file matching `.env.*` (except `.env.example`) are ignored in `.gitignore`.
   - Never commit `.env` files containing real production passwords, API tokens, or encryption keys.

3. **Cloudflare Workers Deployment Secrets**:
   - Production secrets on Cloudflare Workers are configured via the Cloudflare dashboard or Wrangler secrets CLI:
     ```bash
     npx wrangler secret put DATABASE_URL
     npx wrangler secret put BETTER_AUTH_SECRET
     npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
     ```
   - Cloudflare Workers injects these as runtime environment bindings, completely segregated from client builds.

---

## 4. Production Hardening & Fail-Fast Guardrails

In production (`NODE_ENV=production`), the configuration layer enforces zero-tolerance fail-fast validation before the server starts or connects to the database:

1. **Authentication Secret Integrity**:
   - Rejects default development secrets and common placeholder strings (e.g. `changeme`, `placeholder`, `development`).
   - Requires minimum 32 characters length.
2. **Database Isolation**:
   - Rejects `localhost` and `127.0.0.1` to prevent production builds from inadvertently relying on or corrupting local developer databases.
3. **CORS Safety**:
   - Rejects wildcard `*`. When credentials (`credentials: true`) are enabled, wildcard origins violate browser security specifications and expose user sessions to cross-origin abuse.
4. **Base URL Enforcement**:
   - Requires canonical external URL (`BETTER_AUTH_URL`) without `localhost` or `127.0.0.1`.
5. **Safe Error Masking**:
   - When configuration validation fails, `ConfigurationError` reports the exact invalid keys and validation rules without printing the raw values of any secrets.

---

## 5. Local Development Setup

To configure a local developer workstation:

1. Copy `.env.example` to `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Start the local database infrastructure:
   ```powershell
   docker compose up -d
   ```
3. Run migrations:
   ```powershell
   npm run db:migrate
   ```
4. Start the backend development server:
   ```powershell
   npm run server:dev
   ```

---

## 6. Test Environment Configuration

Automated tests run with `NODE_ENV=test`:
- Uses in-memory or isolated test databases.
- Uses safe, deterministic test credentials that never touch external services.
- Never weaken production validation schemas to satisfy test requirements; use isolated environment dictionaries in test cases.
