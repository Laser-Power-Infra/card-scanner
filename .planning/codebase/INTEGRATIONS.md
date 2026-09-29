---
last_mapped_commit: 6d075c5e67e12a028a845bd113940e927aaa73c4
last_mapped_at: 2026-09-29
---
# External Integrations

**Analysis Date:** 2026-09-29

## APIs & External Services

**OpenAI (vision LLM) — the product's core dependency:**

- Used for: (a) business card image extraction, (b) public-profile enrichment
- SDK/Client: `openai` 4.104.0
- Auth: `OPENAI_API_KEY` env var
- Call sites:
  - `lib/extractCard.ts:75-111` — `openai.chat.completions.create` with `model: "gpt-5.6-luna"`, `max_tokens: 800`, `response_format: { type: "json_object" }`, and an inline base64 `image_url` data URI at `detail: "high"`
  - `app/api/profile/enrich/route.ts:90-110` — same model/params, text-only prompt asking the model to research the person's public profile
- System prompts are inline template literals: `SYSTEM_PROMPT` in `lib/extractCard.ts:5-45`, `PROMPT` in `app/api/profile/enrich/route.ts:7-30`. No prompt file, no prompt versioning, no temperature/seed pinning.
- Output parsing is defensive, not schema-enforced: `extractJson()` (`lib/extractCard.ts:47-62`) strips ```json fences then falls back to first-`{`/last-`}` slicing. `app/api/profile/enrich/route.ts` calls `JSON.parse` with no try/catch around it (the outer handler catches).
- **Client lifecycle:** a new `OpenAI` instance is constructed per call in both files. There is no module-level singleton and no connection reuse.
- **Failure modes:** missing key throws a configuration error (`lib/extractCard.ts:69-73`) or returns HTTP 500 (`app/api/profile/enrich/route.ts:87`). A missing/empty completion throws (`lib/extractCard.ts:115-117`) or returns 502 (`app/api/profile/enrich/route.ts:114-122`). Unparseable JSON throws (`lib/extractCard.ts:129-133`).
- **No cost controls in code:** no retry/backoff, no token accounting, no request budget, no per-user quota. `max_tokens: 800` and `detail: "high"` are the only cost levers present.
- `app/api/scan/route.ts:172-177` exposes `GET /api/scan` returning `{ status: "ok", apiKeyPresent: !!process.env.OPENAI_API_KEY }` — an unauthenticated endpoint that discloses whether the OpenAI key is configured.

**RabbitMQ (async enrichment queue):**

- Used for: handing contact research tasks to an external worker
- SDK/Client: `amqplib` 2.2.0
- Auth/URL: `RABBITMQ_URL` env var (full connection string incl. credentials)
- Topology: one durable queue, `CS-profile:collection` (`lib/queue/config.ts:2`), asserted on every publish (`lib/queue/profileCollection.ts:24`). Messages sent with `{ persistent: true }` (`lib/queue/profileCollection.ts:34-38`).
- Tags: `research`, `linkedin`, `whatsapp`, `instagram`, `facebook`, `twitter` (`lib/queue/config.ts:5-12`)
- Payload shape: `ProfileCollectionTaskPayload` (`lib/queue/profileCollection.ts:5-11`) — `{ tag, taskId, contactId?, contact: CardData, timestamp }`. `rawNotes` is stripped before publishing (`lib/queue/profileCollection.ts:56`) to keep messages small.
- Producers:
  - `app/api/scan/route.ts:126-170` — `pushResearchTask()` fires on every new contact and every merged contact; called at lines 403 and 457. Disabled for the spreadsheet-import path (commented out at line 295).
  - `app/actions/profile-collection.ts:23-92` — `publishProfileCollection()` Server Action; DEVELOPER role only.
  - `app/actions/profile-collection.ts:104-199` — `researchAllContacts()` Server Action; DEVELOPER role only, iterates every contact and publishes one message each.
- **Connection management:** module-level `model`/`channel` singletons in `lib/rabbitmq.ts:3-4`, reset on `error`/`close` events (`lib/rabbitmq.ts:15-24,40-47`).
- **Degradation:** every failure path returns `null`/`false` and logs a warning rather than throwing (`lib/rabbitmq.ts:9,27-29`; `lib/queue/profileCollection.ts:18-21,47-50`). A scan therefore succeeds even when the queue is down — enrichment is silently lost.
- **No consumer in this repository.** Grepping for `consume(` returns nothing. The worker that reads `CS-profile:collection` and writes back to the `Enrichment`/`LocationCache` tables lives in a separate codebase. There is no `ack`/`nack`, no dead-letter exchange, no confirm channel, and no retry/requeue logic here.
- **Credentials hygiene note:** `lib/rabbitmq.ts:8` logs the full connection string (`console.log("[RabbitMQ] Connecting to:", url)`), which will include the password in container logs.

**Nominatim / OpenStreetMap (geocoding fallback):**

- Used for: resolving free-text location strings to lat/lng when the curated city table misses
- Client: global `fetch` — no SDK
- Endpoint: `GET https://nominatim.openstreetmap.org/search?format=json&limit=1&q=<encoded>` (`lib/location.ts:447`)
- Auth: none (public endpoint, no API key)
- Required header: `User-Agent: Card Scanner business-card-scanner` (`lib/location.ts:449`) — Nominatim's usage policy requires a identifying UA
- **Rate limiting is manual:** a module-global `lastGeocodeAt` timestamp plus an enforced 1100ms sleep between calls (`lib/location.ts:433,442-444`). This serializes geocoding per Node process and is lost on restart.
- **Cache (two tiers):** in-memory `GEOCODE_CACHE` Map (`lib/location.ts:432`) plus the persistent Postgres `LocationCache` table, read/written by `app/api/locations/route.ts`, `app/api/locations/resolve/route.ts`, `app/api/locations/batch/route.ts`, and `preCacheLocation()` in `app/api/scan/route.ts:10-35`.
- Callers of the resolver `resolveLocationCoords()` (`lib/location.ts:464-488`): tier 1 is the offline `CITY_COORDS` table (`lib/location.ts:337-417`, ~70 Indian cities plus 7 international), tier 2 is the Nominatim call.

**Esri ArcGIS Online (map tiles):**

- Used for: raster basemap rendering in `components/ContactMap.tsx`
- Auth: none — free public tile endpoints, no API key (`components/ContactMap.tsx:41-43`)
- Three layers:
  - Street: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}` (`components/ContactMap.tsx:38-39`)
  - Satellite: `.../World_Imagery/MapServer/tile/{z}/{y}/{x}` (`components/ContactMap.tsx:42-43`)
  - Labels overlay: `.../Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}` (`components/ContactMap.tsx:45-46`)
- Attribution string is present in code (`components/ContactMap.tsx:48-49`). Esri's terms require that attribution be displayed — verify it renders in the shipped UI.
- Browser-side only. Every map view issues tile requests from the end user's IP, not from the server.

**unpkg.com (CDN asset host):**

- Used for: Leaflet marker icons, which break under bundlers (`components/ContactMap.tsx:9-21`)
- URLs: `https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png`, `marker-icon-2x.png`, `marker-shadow.png`
- Auth: none. This is a runtime third-party dependency on unpkg's availability from every client browser.

**Google Fonts (build-time):**

- `next/font/google` self-hosts at build time: Fraunces, Inter, IBM Plex Mono (`app/layout.tsx:2,9-26`)
- No runtime call from end users, but the Docker build requires network egress to fonts.googleapis.com or `next build` will warn/fail.

## Data Storage

**Databases:**

- PostgreSQL — the only database
  - Connection: `DATABASE_URL` env var
  - Client: Prisma 7.10.0 with the `@prisma/adapter-pg` driver adapter (`lib/prisma.ts:10-18`), backed by `pg` 8.23.0
  - Generated client location: `lib/generated/prisma` (gitignored; regenerate with `npx prisma generate`)
  - Singleton: `lib/prisma.ts:14-22` caches on `globalThis` outside production to survive Next.js dev HMR
- **Models** (`prisma/schema.prisma`):
  - `Contact` — the core record. Uses Postgres array columns (`String[]`) for `mobileNumbers`, `telephoneNumbers`, `emails` (lines 22-25). This array-column choice is why duplicate detection builds raw `has` filter clauses (`app/api/scan/route.ts:372-377`, `285-287`) and why the dedupe script only ever inspects `[0]` (`scripts/dedupeContacts.ts:13-15`).
  - `User` — email/password with `Role` enum `USER | ADMIN | DEVELOPER` (lines 40-62)
  - `Enrichment` — 1:1 with Contact via `contact_id` PK, `onDelete: Cascade`, with `EnrichmentStatus` enum `PENDING | RUNNING | DONE | PARTIAL | FAILED` and attempt counters (lines 64-103). Written by the external worker, not by this app's code.
  - `PasswordResetToken` — token + 1-hour expiry (lines 105-115)
  - `LocationCache` — geocode memoization keyed by normalized `query` (lines 117-125)
- **Migrations:** 7 applied migrations under `prisma/migrations/` (dated 2026-07-07 through 2026-09-16). New schema changes must ship as a new migration; the Dockerfile copies `prisma/` but never runs `prisma migrate deploy`, so migration execution is an out-of-band operational step.
- **Deduping:** no unique constraints on contact identity. Uniqueness is enforced only in application logic at scan time (email OR phone OR name+company), and the spreadsheet import path has a bug where the `AND` name+company clause is pushed into the same flat `OR` list as the array `has` clauses (`app/api/scan/route.ts:272-287`), so it matches on name alone or company alone.

**File Storage:**

- Local filesystem only, for static assets in `public/`. No S3, GCS, Azure Blob, or any object store. Uploaded card images are held in memory as base64 during the request and never persisted (`app/api/scan/route.ts:351-354`).

**Caching:**

- No Redis, Memcached, or Vercel KV.
- In-process Maps: `GEOCODE_CACHE` (`lib/location.ts:432`), `SESSION_CACHE` (`components/ContactMap.tsx:52`)
- Postgres-backed: `LocationCache` table
- Next.js caching: no `revalidate`, `unstable_cache`, or `use cache` calls anywhere. All route handlers are dynamic by default.

## Authentication & Identity

**Auth Provider:**

- Custom credentials auth via next-auth 4.24.15 — no OAuth providers, no social login, no SAML/OIDC
  - Implementation: `CredentialsProvider` with email + password verified against the `User` table via `bcrypt.compare`
  - Session strategy: JWT (`lib/auth.ts:8-10`), so no session store; `id` and `role` are copied onto the token and session in the callbacks (`lib/auth.ts:73-91`)
  - Secret: `NEXTAUTH_SECRET` env var
  - Custom sign-in page: `/login` (`lib/auth.ts:12-15`)
- **Config duplication:** the full `NextAuthOptions` object is defined twice — `lib/auth.ts:7-94` and `app/api/auth/[...nextauth]/route.ts:8-74`. They have diverged: the route-handler copy lowercases and trims the email before lookup (line 30) and defines no `error` page, while `lib/auth.ts` looks up the raw email and routes errors to `/login`. `lib/auth.ts` is the one consumed by `lib/permissions.ts` and the Server Actions, so the two paths can authenticate the same user differently.
- **Route protection:** `middleware.ts` wraps `withAuth` and enforces the public allowlist (`/`, `/login`, `/register`, `/forgot-password*`, `/reset-password*`, `/api/auth*`) plus an ADMIN-only gate on `/admin` (`middleware.ts:9-17`). Matcher covers `/dashboard`, `/directory`, `/admin`, `/login`, `/register` only — so every `/api/*` route outside `/api/auth` is reachable without a session, including `GET /api/contacts` (`app/api/contacts/route.ts`) and `GET /api/profile/[id]` (`app/api/profile/[id]/route.ts`).
- **Role model:** `USER`, `ADMIN`, `DEVELOPER` (`prisma/schema.prisma:40-44`, mirrored as a TS enum in `lib/permissions.ts:4-8`). Only `DEVELOPER` can publish research tasks (`app/actions/profile-collection.ts:29,110`).
- **Custom auth endpoints alongside next-auth:** registration (`app/api/auth/register/route.ts`), password reset request (`app/api/auth/forgot-password/route.ts`), and password reset consumption (`app/api/auth/reset-password/route.ts`) are hand-rolled, not next-auth flows.
- **`@auth/prisma-adapter` is installed but never imported** — correct for JWT sessions, but it is dead weight in `package.json`.
- **No email provider is wired.** `app/api/auth/forgot-password/route.ts:52-64` has an explicit TODO to add Nodemailer/Resend/SendGrid; today it generates a 32-byte `crypto.randomBytes` token with a 1-hour expiry, logs the reset URL to the server console, **and returns the raw `resetLink` in the HTTP response body**. Any unauthenticated caller can reset any user's password by supplying their email.
- Password policy is inconsistent: minimum 8 characters at registration (`app/api/auth/register/route.ts:22`) vs minimum 6 at reset (`app/api/auth/reset-password/route.ts:20`).

## Monitoring & Observability

**Error Tracking:**

- None. No Sentry, Datadog, Bugsnag, or any error-reporting SDK.

**Logs:**

- `console.log` / `console.error` / `console.warn` only, across all of `lib/`, `app/api/`, and `app/actions/`
- No structured logging, no log levels, no request-ID correlation, no redaction
- Sensitive values currently reach logs: the full RabbitMQ connection string (`lib/rabbitmq.ts:8`), extracted card PII to stdout (`lib/extractCard.ts:126-128`), the password-reset link (`app/api/auth/forgot-password/route.ts:54-57`), and the entire auth error object (`lib/auth.ts:66`)

**Health checks:**

- `GET /api/health` (`app/api/health/route.ts`) returns `{ status, uptime, timestamp }` with `Access-Control-Allow-Origin: *`. It is a liveness probe only — it does not check Postgres, RabbitMQ, or OpenAI.

## CI/CD & Deployment

**Hosting:**

- Self-managed Docker host reached over SSH-less GitHub Actions self-hosted runner
- `docker-compose.yml` pulls `ghcr.io/laser-power-infra/card_scanner:${APP_VERSION:-latest}`, maps `4111:4111`, joins the external Docker network `infra`, and reads env from `.env.production`
- Postgres and RabbitMQ are NOT in this compose file — they are pre-existing services on the shared `infra` network

**CI Pipeline:**

- GitHub Actions, `.github/workflows/deploy.yml`, triggered on push to `main`
- Job 1 `build-and-push` (ubuntu-latest): Buildx build of `Dockerfile`, push to GHCR as `:latest` and `:<short-sha>`, GHA layer cache
- Job 2 `deploy` (self-hosted, Windows PowerShell, `D:/card-scanner`): `docker compose pull` → `up -d --no-deps` → prune all but the 2 newest images
- **No test stage and no lint stage.** `npm run lint` exists in `package.json` but is never run by automation; only `next build`'s implicit typecheck gates the pipeline.

## Environment Configuration

**Required env vars:**

- `DATABASE_URL` — Postgres connection string. Read at `lib/prisma.ts:11` and `prisma.config.ts:12`. The Dockerfile supplies a dummy value at build time (`Dockerfile:31`) so `prisma generate` and `next build` work without a live DB; a real value is mandatory at runtime.
- `OPENAI_API_KEY` — required for any scan or enrichment. Without it, `/api/scan` fails at `lib/extractCard.ts:69` and `/api/profile/enrich` returns 500.
- `NEXTAUTH_SECRET` — required to sign JWT sessions (`lib/auth.ts:93`, `app/api/auth/[...nextauth]/route.ts:73`).
- `RABBITMQ_URL` — full AMQP connection string. Optional: the app runs without it but silently stops enqueuing enrichment tasks.
- `NODE_ENV=production`, `PORT=4111`, `HOSTNAME=0.0.0.0` — set by `docker-compose.yml:17-19`
- `APP_VERSION` — image tag selector, injected by the deploy job (`.github/workflows/deploy.yml:62`)

**Not referenced in code:** `NEXTAUTH_URL` appears in no source file. next-auth v4 generally requires it for callback/redirect URL construction; the code works around this by deriving origins from the request.

**Secrets location:**

- Local development: `.env` in the repo root (exists; contents not inspected). Covered by `.gitignore:3-4` (`.env*`, `.env.local`).
- Production: `.env.production` on the deployment host, consumed by `docker-compose.yml:14` via `env_file`. Not present in the working tree.
- CI: `secrets.GITHUB_TOKEN` for GHCR push (`.github/workflows/deploy.yml:39`). No other CI secrets.
- No vault, KMS, or secret manager is used.
- Note: `.env.example` is referenced by `README.md:41` but does not exist. A new developer has no template to copy.

## Webhooks & Callbacks

**Incoming:**

- None. There is no webhook receiver endpoint, no signature verification, and no external service posts to this app.
- The nearest analogues are the hand-rolled auth endpoints (`app/api/auth/register`, `app/api/auth/forgot-password`, `app/api/auth/reset-password`) and the next-auth catch-all (`app/api/auth/[...nextauth]`), all of which are user-initiated rather than service-initiated.

**Outgoing:**

- **RabbitMQ messages** are the only outbound callback surface. The app publishes `CS-profile:collection` messages and expects the external worker to complete them by writing `Enrichment` rows back into Postgres. There is no acknowledgement path back to the app — enrichment status is polled via `GET /api/contacts` and `GET /api/profile/[id]`, both of which `include: { enrichment: true }`.
- No payment processors (no Stripe, Razorpay, or similar), no SMS gateways, no push notification services, no outbound email.

---

*Integration audit: 2026-09-29*
