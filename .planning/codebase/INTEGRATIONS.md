# External Integrations

**Analysis Date:** 2026-10-03

## APIs & External Services

**OpenAI (Vision API — Card Extraction):**
- What: Extracts business card fields from uploaded images using GPT-5.6-luna with `detail: "high"` and `max_tokens: 800`. Returns structured JSON matching the `CardData` type.
- SDK/Client: `openai` 4.104.0 — `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` instantiated per-call in `lib/extractCard.ts:75-77`
- Auth: `OPENAI_API_KEY` env var
- Key files: `lib/extractCard.ts` (system prompt + vision call + JSON unwrap), `app/api/scan/route.ts` (invokes extraction)
- Pattern: Synchronous request-response. The scan route awaits the OpenAI call before persisting. Fenced-JSON unwrapping via `extractJson()` at `lib/extractCard.ts:47-62`. Defensive field coercion with `Array.isArray` checks and `?? null` defaults at `lib/extractCard.ts:135-167`.
- Notable: `console.log` dumps extracted PII at `lib/extractCard.ts:126-128` — a debug affordance that should not be propagated to new code.

**OpenAI (LLM — Profile Enrichment):**
- What: Synchronous "web research" that takes a contact's card data and returns an `EnrichedProfile` with LinkedIn, company details, career background, social profiles, and summary. Not persisted — the client uses this for immediate display while the async worker handles persistent enrichment.
- SDK/Client: `openai` 4.104.0 — separate client instantiation in `app/api/profile/enrich/route.ts`
- Auth: `OPENAI_API_KEY` env var
- Key files: `app/api/profile/enrich/route.ts` (prompt + call + response mapping)
- Pattern: Synchronous POST endpoint. Uses `requireApiSession()` gate. Returns `NextResponse.json()` with the enriched profile or an error. The prompt at `app/api/profile/enrich/route.ts:8-31` instructs the model to return JSON only.

**Nominatim (OpenStreetMap Geocoding):**
- What: Free geocoding fallback for addresses not in the curated `CITY_COORDS` table. Used to resolve `[lat, lng]` for map markers.
- SDK/Client: None — raw `fetch()` call to `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=...` at `lib/location.ts:447-450`
- Auth: None (public API), but requires a `User-Agent` header (`lib/location.ts:449`)
- Key files: `lib/location.ts` — `geocodeFallback()` at `:435-462`, `resolveLocationCoords()` at `:464-488`
- Pattern: Two-phase resolution: (1) curated offline city table (`CITY_COORDS` at `lib/location.ts:337-417`) for instant lookup, (2) Nominatim network fallback with in-process `Map` cache (`GEOCODE_CACHE` at `lib/location.ts:432`) and rate limiting (`setTimeout` pacing at 1 request/sec at `lib/location.ts:442-443`). Returns `null` on any failure — never throws.
- Notable: The curated table covers ~70 Indian cities and ~30 international cities. The `LocationCache` Prisma model (`prisma/schema.prisma:129-136`) persists geocode results to the database for cross-request reuse.

## Data Storage

**Databases:**
- PostgreSQL (provider declared in `prisma/schema.prisma:12`)
  - Connection: `DATABASE_URL` env var, read in `lib/prisma.ts:11` and `prisma.config.ts:12`
  - Client: Prisma 7.8.0 with `@prisma/adapter-pg` 7.8.0 driver adapter + `pg` 8.22.0 underlying client
  - Key files: `lib/prisma.ts` (singleton with `globalThis` caching), `prisma/schema.prisma` (schema), `prisma/migrations/` (migrations)
  - Pattern: Prisma 7 driver adapter pattern — `new PrismaPg({ connectionString })` passed to `new PrismaClient({ adapter })`. Global singleton cached on `globalThis` in non-production to survive HMR (`lib/prisma.ts:6-22`). Generated client output redirected to `../lib/generated/prisma` (gitignored).
  - Models: `Contact`, `User`, `Enrichment`, `PasswordResetToken`, `LocationCache` — see `prisma/schema.prisma:15-137`
  - Indexes: GIN indexes on `emails`, `mobileNumbers`, `telephoneNumbers` arrays; composite index on `[fullName, company]`; descending index on `createdAt` (`prisma/schema.prisma:39-43`)

**File Storage:**
- Local filesystem only — `public/` holds only `.gitkeep`. Images are base64-encoded in memory (`app/api/scan/route.ts:352`) and never persisted to disk.

**Caching:**
- In-process `Map` for geocode results (`GEOCODE_CACHE` at `lib/location.ts:432`)
- Database-backed `LocationCache` table for persistent geocode caching (`prisma/schema.prisma:129-136`)
- No Redis, no Memcached, no external cache service

## Authentication & Identity

**Auth Provider:**
- NextAuth v4 (Auth.js) with Credentials provider only
  - Implementation: JWT session strategy (no database adapter). `bcryptjs` for password hashing/verification.
  - Key files: `lib/auth.ts` (authOptions — used by server actions and `lib/permissions.ts`), `app/api/auth/[...nextauth]/route.ts` (NextAuth handler — divergent copy of authOptions), `middleware.ts` (edge route gating)
  - Pattern: `CredentialsProvider` with email/password. `authorize()` callback at `lib/auth.ts:35-72` looks up user by email, compares password with `bcrypt.compare()`, returns user object with `role` and `mustResetPassword`. JWT callbacks at `lib/auth.ts:77-106` inject `id`, `role`, and `mustResetPassword` into the token and session.
  - Middleware: `withAuth` from `next-auth/middleware` at `middleware.ts:4-54`. Edge runtime — cannot use Prisma or Node crypto. Relies purely on JWT in the NextAuth cookie. `authorized` callback whitelists public routes (`/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/force-reset`, `/api/auth`). Admin-only routes (`/admin`) are gated by checking `token.role !== "ADMIN"` in the middleware function.
  - Role model: `USER`, `ADMIN`, `DEVELOPER` enum (`prisma/schema.prisma:46-50`). `DEVELOPER` can publish enrichment tasks. `ADMIN` can access `/admin`. Both `ADMIN` and `DEVELOPER` can reset passwords.
  - API route protection: `requireApiSession()` and `requireApiRole()` in `lib/permissions.ts:215-251` — per-handler gate returning `NextResponse` or `null`. `PUBLIC_API_PATHS` at `lib/permissions.ts:53-72` is a test-only classifier (not a runtime gate) used by the security boundary test suite.
  - Password reset: `PasswordResetToken` model (`prisma/schema.prisma:115-127`) with token, expiry, and optional `passwordHash`. Reset endpoint is role-gated (ADMIN + DEVELOPER only) and CSRF-resistant via `SameSite=Lax` cookie.

## Monitoring & Observability

**Error Tracking:**
- None — no Sentry, no Rollbar, no external error tracking service

**Logs:**
- `console.log` / `console.warn` / `console.error` with bracketed subsystem tags
- Tag conventions: `[RabbitMQ]`, `[Scan]`, `[ProfileCollection]`, `[Auth]`, `[preCacheLocation]`
- Pattern: First argument is the tag, followed by the message. Example: `console.error("[RabbitMQ] Failed to publish task:", err)`
- No structured logging, no log levels, no log aggregation

## CI/CD & Deployment

**Hosting:**
- Self-hosted Windows PowerShell runner at `D:/card-scanner` (`.github/workflows/deploy.yml:85-114`)
- Docker image stored in GitHub Container Registry (GHCR) at `ghcr.io/laser-power-infra/card_scanner`
- Container runs on external `infra` Docker network, port `4111` (`docker-compose.yml:25-32`)

**CI Pipeline:**
- GitHub Actions: `.github/workflows/deploy.yml`
- Trigger: push to `main`
- Jobs:
  1. **verify** (`:9-36`): `pnpm install --frozen-lockfile` → `pnpm run typecheck` (with dummy `DATABASE_URL`) → `pnpm run lint` → `pnpm test`
  2. **build-and-push** (`:38-80`): Docker Buildx build → push to GHCR with `latest` and short-SHA tags
  3. **deploy** (`:82-114`): Self-hosted runner pulls image, `docker compose up -d`, prunes old images keeping last 2
- Pattern: 3-stage Docker build (`Dockerfile:1-72`): (1) `pnpm install --frozen-lockfile` with BuildKit cache mount, (2) `prisma generate` + `pnpm run build` with dummy `DATABASE_URL`, (3) runtime copies only `.next/standalone`, `.next/static`, `public/`, runs as `node` user
- Image tags: `latest` and short commit SHA. Compose uses `${APP_VERSION:-latest}` for the image tag.

## Message Queue

**RabbitMQ:**
- What: Offloads profile enrichment to an external worker. The web app publishes tasks; an out-of-repo consumer processes them and writes `Enrichment` records.
- SDK/Client: `amqplib` 2.0.1
- Auth: `RABBITMQ_URL` env var (AMQP connection string)
- Key files: `lib/rabbitmq.ts` (connection/channel singleton), `lib/queue/profileCollection.ts` (publisher), `lib/queue/config.ts` (queue name + tag union)
- Pattern: Module-level singleton with auto-reconnect. `lib/rabbitmq.ts:3-4` holds `let model` / `let channel` at module scope. On `error` or `close`, both are nulled to force reconnect on next call (`lib/rabbitmq.ts:15-24,40-47`). `getChannel()` at `lib/rabbitmq.ts:32-53` lazily creates the channel. `closeConnection()` at `lib/rabbitmq.ts:55-65` is exported but never called in application code.
- Queue: `CS-profile:collection` (`lib/queue/config.ts:2`), declared durable (`lib/queue/profileCollection.ts:24`), messages sent persistent (`lib/queue/profileCollection.ts:34-38`)
- Message payload: `ProfileCollectionTaskPayload` (`lib/queue/profileCollection.ts:5-11`) — `{ tag, taskId?, contactId?, contact: CardData, timestamp }`. The `rawNotes` field is stripped before publishing (`lib/queue/profileCollection.ts:56`).
- Tags: `research`, `linkedin`, `whatsapp`, `instagram`, `facebook`, `twitter` (`lib/queue/config.ts:5-12`)
- Fire-and-forget: `publishToQueue()` at `lib/queue/profileCollection.ts:13-51` returns `boolean` (not `void`). Callers log warnings on failure but never throw. A missing RabbitMQ yields a logged warning and a successful HTTP response.
- Graceful degradation: `getModel()` returns `null` when `RABBITMQ_URL` is unset (`lib/rabbitmq.ts:9`). `getChannel()` returns `null` when connection fails. `publishToQueue()` returns `false`. The app continues to function without enrichment.

**External RabbitMQ Worker (Out-of-Repo Consumer):**
- What: Consumes `CS-profile:collection` queue messages, performs web research on each contact, and writes `Enrichment` records to the database.
- Location: Different repository — not part of this codebase
- Contract: The worker reads `ProfileCollectionTaskPayload` from the queue, uses `contactId` to update the `Enrichment` row, and sets `status` to `DONE`, `PARTIAL`, or `FAILED`. The web app polls `/api/profile/[id]` to detect completion.
- Enrichment status state machine: `PENDING` → `RUNNING` → `DONE` | `PARTIAL` | `FAILED` (`prisma/schema.prisma:72-78`). The web app's `ProfileSlideOver` component polls every 5s while status is `PENDING` or `RUNNING` (`components/ProfileSlideOver.tsx:128-137`).

## Webhooks & Callbacks

**Incoming:**
- None — no webhook endpoints

**Outgoing:**
- None — no outgoing webhooks. All outbound communication is via the RabbitMQ queue publish.

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` — PostgreSQL connection string (required at runtime and build time)
- `OPENAI_API_KEY` — OpenAI API key (required for card extraction and enrichment)
- `NEXTAUTH_SECRET` — NextAuth JWT signing secret (required for auth)
- `RABBITMQ_URL` — AMQP connection string (optional — app degrades gracefully without it)

**Secrets location:**
- `.env` file in repo root (gitignored) for local development
- `.env.production` file loaded by `docker-compose.yml:14` for production (not in working tree)
- No secrets manager, no Vault, no AWS Secrets Manager

---

*Integration audit: 2026-10-03*
