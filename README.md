# Card Scanner

Turn business cards into a searchable contact directory.

Upload a photo of a card, or a spreadsheet of contacts. The app reads the card
with an AI vision model, stores the details in Postgres, drops the contact on
a map, and hands the name to a background worker that researches it into a full
profile. Three view modes (table, cards, map), a slide-over profile panel, and
one-tap `.vcf` export sit on top.

**Core idea:** an uploaded card becomes a correct, deduplicated, geolocated
contact, with no retyping.

---

## Table of contents

- [What it does](#what-it-does)
- [How a scan works](#how-a-scan-works)
- [How the app is put together](#how-the-app-is-put-together)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [API reference](#api-reference)
- [Access control](#access-control)
- [Enrichment (the background worker)](#enrichment-the-background-worker)
- [Locations and the map](#locations-and-the-map)
- [Tests and quality gates](#tests-and-quality-gates)
- [Deployment](#deployment)
- [Maintenance scripts](#maintenance-scripts)
- [Known gaps](#known-gaps)

---

## What it does

- **Card scanning.** Drop or pick an image. The browser shrinks it to 1200px
  first, then posts it to the server, which sends it to OpenAI's vision model
  and gets back clean JSON.
- **Spreadsheet import.** CSV, XLS or XLSX. Column headers are matched to
  contact fields by fuzzy name, so you do not need a fixed template.
- **Dedupe and merge.** On every scan the app looks for an existing contact by
  email, mobile, telephone, or name + company. If it finds one, it merges only
  the fields that are new. If nothing is new, it says so and writes nothing.
- **Three views.** Table (filter on 8 fields, paginated), cards grid, and a
  Leaflet map with street/satellite/labels layers.
- **Enrichment.** A button per channel (research, LinkedIn, WhatsApp,
  Instagram, Facebook, Twitter) publishes a job to RabbitMQ. An external worker
  does the research and writes the result back. The panel polls for it.
- **Export.** The filtered list exports as a `.vcf` file that opens directly in
  Contacts.
- **Accounts.** Email + password sign-in with NextAuth, plus register, forgot
  password and reset password pages.

Nothing is written to disk. Images are base64-encoded in memory, read by the
model, and thrown away.

---

## How a scan works

```
  Browser                          Server                       OpenAI
  ------                           ------                       -----
  pick a file
      |
      |  canvas resize: max 1200px, JPEG 0.85
      |
      |  POST /api/scan   (multipart FormData)
      +-------------------------------->
                                        check type + size (<= 8MB)
                                            |
                                            +-- image  --> extractCard.ts
                                            |                  |
                                            |                  | model: gpt-5.6-luna
                                            |                  | detail: high
                                            |                  | max_tokens: 800
                                            |                  v
                                            |             JSON text
                                            |                  |
                                            |         unwrap + coerce fields
                                            |
                                            +-- sheet  --> xlsx parse
                                                               |
                                                               v
                                        dedupe query on Postgres
                                          no match --> create contact
                                          match    --> merge new fields only
                                            |
                                            +--> pre-cache map location
                                            +--> publish research job (RabbitMQ)
                                            |
      <--- { success, data, matchedBy?, message? }
      |
  merge results from multiple photos
  render contact / table / map
```

Two details worth knowing:

- **One vision call, not OCR + parse.** The model reads the card directly. That
  removes a whole separate OCR service and one extra network hop.
- **Fire-and-forget side effects.** Pre-caching the location and publishing the
  research job each run in their own `try/catch`. If RabbitMQ is down the scan
  still succeeds; you just lose the enrichment.

---

## How the app is put together

One Next.js app. There is no separate backend service.

```
+----------------------------------------------------------------------+
|  Browser                                                            |
|                                                                      |
|  app/page.tsx  -- upload, search, filters, 3 view modes, vCard       |
|  auth pages    -- login, register, forgot-password, reset-password    |
|  /dashboard    -- shell, placeholder numbers                         |
|  /directory    -- shell over hardcoded sample data (not wired up)    |
|  /admin        -- shell, ADMIN only, placeholder numbers             |
+---------------------------+------------------------------------------+
                            |  fetch() to /api/*   and   SessionProvider
                            v
+----------------------------------------------------------------------+
|  Edge middleware  (middleware.ts, runs on the Edge runtime)         |
|  gates only these pages: /dashboard /directory /admin /login         |
|  /register.  Redirects logged-in users away from /login,/register.  |
+---------------------------+------------------------------------------+
                            v
+----------------------------------------------------------------------+
|  Next.js server                                                     |
|                                                                      |
|  Route handlers (app/api/**/route.ts)  -- all HTTP endpoints        |
|  Server actions  (app/actions/**.ts)    -- queue publishing only     |
|                                                                      |
|  +------------------+  +----------------+  +----------------------+ |
|  | Postgres          |  | RabbitMQ       |  | OpenAI               | |
|  | via Prisma 7      |  | queue           |  | vision + JSON        | |
|  | + adapter-pg      |  | "CS-profile:    |  | gpt-5.6-luna         | |
|  | Contact, User,    |  |  collection"    |  +----------------------+ |
|  | Enrichment,       |  +--------+-------+  +----------------------+ |
|  | PasswordReset     |           |          | Nominatim / Esri tiles |
|  | Token,            |           v          | (geocode + map)        |
|  | LocationCache     |  +--------------------+                          |
|  +------------------+  | worker (OTHER REPO) |                          |
|                        | writes Enrichment   |                          |
|                        +---------------------+                          |
+----------------------------------------------------------------------+
```

### The five layers

| Layer | Where | What it does |
|-------|-------|--------------|
| Presentation | `app/**/*.tsx`, `components/*.tsx` | All UI. Holds user state, calls the API. |
| HTTP | `app/api/**/route.ts` | Parses requests, validates, orchestrates, shapes JSON. |
| Server actions | `app/actions/*.ts` | The one privileged path into the queue. |
| Shared logic | `lib/**` | Prompts, lookup tables, external clients, pure helpers. |
| Data | `prisma/schema.prisma` | The 5 tables and 2 enums. |

### Two things that surprise people

- **Every page is a client component.** Only `app/layout.tsx` runs on the
  server. Data always arrives via `fetch()` from a `useEffect`. There is no
  server-component data layer, no `loading.tsx`, no `Suspense`.
- **The browser holds the whole contact list.** The database is a plain store.
  Search, filter, dedupe and pagination all run in the browser, not in SQL.

---

## Tech stack

| Piece | Choice |
|-------|--------|
| Framework | Next.js 15 App Router, React 18.3.1 |
| Language | TypeScript 5, `strict: true` |
| Database | PostgreSQL through Prisma 7 (`@prisma/adapter-pg` + `pg`) |
| Auth | next-auth v4, credentials only, JWT sessions |
| AI | `openai` SDK, model `gpt-5.6-luna` |
| Queue | RabbitMQ via `amqplib` |
| Styling | Tailwind CSS 3 |
| Map | Leaflet 1.9 with Esri tiles |
| Files | `xlsx` for CSV/XLS/XLSX |
| Passwords | `bcryptjs` |
| Tests | Vitest 5 |
| Lint | ESLint 10 flat config (no `eslint-config-next`) |
| Runtime | Node 22, npm |

Ports: **4000** in dev, **4111** in production.

---

## Getting started

**You need:** Node.js 22, npm, a reachable PostgreSQL database, an OpenAI API
key with prepaid credit, and optionally a RabbitMQ instance.

```bash
npm install
npx prisma generate     # writes the Prisma client into lib/generated/prisma
npx prisma migrate deploy
```

Then create a `.env` in the repo root (there is no `.env.example` in the repo,
so copy the table below):

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/cardscanner
NEXTAUTH_SECRET=<any long random string>
OPENAI_API_KEY=sk-...
RABBITMQ_URL=amqp://user:pass@localhost:5672
```

Start the dev server:

```bash
npm run dev
```

Open <http://localhost:4000>. To test from a phone on the same network, use your
machine's LAN IP instead of `localhost` -- `192.168.1.196` and `192.168.1.200`
are already allowed in `next.config.ts`.

### Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server on port 4000 |
| `npm run build` | Production build (also type-checks) |
| `npm start` | Production server on port 4111 |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | `prisma generate` + `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint over the repo |
| `npm run backfill:location` | Fill in missing `state` on stored contacts |

---

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | PostgreSQL connection string. The Docker build uses a dummy value at build time; a real one is needed at runtime. |
| `OPENAI_API_KEY` | yes | Needed for any scan or enrichment. Without it `/api/scan` throws and `/api/profile/enrich` returns 500. |
| `NEXTAUTH_SECRET` | yes | Signs the session JWT. |
| `RABBITMQ_URL` | no | Full AMQP string. The app runs without it but silently stops publishing research jobs. |
| `NODE_ENV` | set by Docker | `production` in the container. |
| `PORT` | set by Docker | `4111` in `docker-compose.yml`. |
| `HOSTNAME` | set by Docker | `0.0.0.0`. |
| `APP_VERSION` | set by CI | Selects which GHCR image tag to deploy. |

`NEXTAUTH_URL` is not referenced anywhere in the source. NextAuth v4 usually
wants it for callback URLs; this app derives origins from the request instead.

---

## Project structure

```
card-scanner/
|
|-- app/                              Next.js App Router
|   |-- layout.tsx                    Root layout. The ONLY server component.
|   |-- page.tsx                      Home page. Upload + directory + map.
|   |-- globals.css                   Tailwind layers + 3 custom classes
|   |-- actions/
|   |   `-- profile-collection.ts     "use server". DEVELOPER-only publishes.
|   |-- login/ register/              Auth pages
|   |-- forgot-password/              Auth pages
|   |-- reset-password/               Auth pages
|   |-- dashboard/                    Shell, placeholder numbers
|   |-- directory/                    Shell, hardcoded sample data
|   |-- admin/                        Shell, ADMIN only
|   `-- api/                          Every HTTP endpoint
|       |-- scan/route.ts             POST image + spreadsheet ingest
|       |-- contacts/route.ts         GET all contacts
|       |-- profile/[id]/route.ts     GET one contact (poll target)
|       |-- profile/enrich/route.ts   POST synchronous LLM research
|       |-- locations/route.ts        POST geocode
|       |-- locations/batch/route.ts  POST batch geocode
|       |-- locations/resolve/        POST resolve and cache
|       |-- locations/cache-check/    POST bulk cache probe
|       |-- health/route.ts           GET liveness probe
|       `-- auth/
|           |-- [...nextauth]/        NextAuth handler
|           |-- register/             POST sign up
|           |-- forgot-password/      POST request a reset
|           `-- reset-password/       POST consume a reset
|
|-- components/                      18 client components, flat, no index.ts
|-- context/AuthProvider.tsx         SessionProvider wrapper
|-- lib/
|   |-- extractCard.ts                Scan prompt + OpenAI call
|   |-- location.ts                   City tables + Nominatim fallback
|   |-- auth.ts                       NextAuth options (one of two copies)
|   |-- permissions.ts                Session and role guards
|   |-- prisma.ts                     Prisma singleton
|   |-- rabbitmq.ts                   AMQP connection singleton
|   |-- resizeImage.ts                Browser-side image downscale
|   |-- queue/
|   |   |-- config.ts                 Queue name + channel names
|   |   `-- profileCollection.ts      The publisher
|   `-- generated/prisma/             GENERATED. Gitignored. Never edit.
|
|-- prisma/
|   |-- schema.prisma                 5 models, 2 enums
|   `-- migrations/                   7 migrations
|-- scripts/                         One-off operator scripts
|-- tests/                            Vitest suite
|-- types/card.ts                     CardData, EnrichedProfile, ScanResponse
|-- middleware.ts                     Edge auth gate. Root, not in app/.
|-- data/india.json                   Indian state name variants
|
|-- Dockerfile                        3 stages, standalone output
|-- docker-compose.yml                Pulls the GHCR image onto network "infra"
|-- eslint.config.mjs
|-- next.config.ts                    standalone output, 10MB action limit
|-- tailwind.config.ts                Design tokens
|-- vitest.config.ts
`-- .github/workflows/deploy.yml      CI: verify, build, deploy
```

There are no barrel files and no `index.ts` anywhere. Every import names the
concrete file. Cross-directory imports use the `@/` alias.

---

## API reference

Every handler returns `{ success: boolean, ... }`. Handlers never throw --
they catch and return a status code.

### Public (no session needed)

| Route | Method | Does |
|-------|--------|------|
| `/api/health` | GET | Liveness. Returns status, uptime, timestamp. CORS open. |
| `/api/auth/*` | GET/POST | NextAuth: sign in, sign out, session, csrf. |
| `/api/auth/register` | POST | Create a user. Email + name + password, min 8 chars. |
| `/api/auth/forgot-password` | POST | Issue a reset token. Always answers the same way, so it cannot be used to discover which emails exist. |
| `/api/auth/reset-password` | POST | Consume a token, set a new password. |

### Needs a session

| Route | Method | Does |
|-------|--------|------|
| `/api/scan` | GET | Health probe: is the OpenAI key present? |
| `/api/scan` | POST | Ingest an image or a spreadsheet. 8MB cap, image MIME allowlist. |
| `/api/contacts` | GET | Every contact, newest first, with enrichment status. |
| `/api/profile/[id]` | GET | One contact plus its enrichment record. |
| `/api/profile/enrich` | POST | Run LLM research now. Result is not stored. |
| `/api/locations` | POST | Geocode one location string. |
| `/api/locations/batch` | POST | Geocode many. |
| `/api/locations/resolve` | POST | Check the cache, geocode if needed, store the result. |
| `/api/locations/cache-check` | POST | Bulk cache probe. Returns `{ cached, missing }`. |

Status codes in use: `400` bad input, `401` no session, `403` wrong role, `404`
not found, `409` email taken, `413` too large, `415` wrong file type, `500`
server error, `502` upstream returned nothing.

---

## Access control

Three layers, and they do different jobs.

```
  Layer 1   Edge middleware (middleware.ts)
            Gates PAGES only. Checks the JWT cookie, nothing else.
            /admin needs role ADMIN. Logged-in users get bounced
            off /login and /register.

  Layer 2   requireApiSession() in each route handler
            The real API gate. Every non-public handler calls it
            first thing and returns its 401 on failure.

  Layer 3   Role checks (requireApiRole)
            401 first, then 403. An anonymous caller can never get a
            403, because a 403 would confirm the route exists.
```

**Roles** come from the `Role` enum in `prisma/schema.prisma`:

| Role | Can do |
|------|--------|
| `USER` | Sign in, use the app |
| `ADMIN` | Everything a user can, plus reach `/admin` |
| `DEVELOPER` | Everything a user can, plus publish research jobs to the queue |

New accounts are always created as `USER`. Promoting one is a manual database
edit.

Two things to be aware of:

- The middleware matcher does not cover `/api/*`, on purpose. `withAuth`
  answers an unauthorized request with a redirect, which would return HTML
  where the app needs a 401. The guard lives in the handlers instead.
- Client-side `useSession()` role checks only hide buttons. They do not
  authorise anything. The server action is the real gate.

---

## Enrichment (the background worker)

This app publishes research jobs. It does not run them. The consumer lives in
a separate repository.

```
  Button click
  (ProfileCollectionButtons / ResearchAllButton)
        |
        v
  server action  app/actions/profile-collection.ts
    - checks role == DEVELOPER
    - checks the channel name is a known tag
    - makes a taskId
        |
        v
  RabbitMQ  queue "CS-profile:collection"
        |
        |   ... worker in another repo does the research ...
        v
  Postgres  Enrichment row written
           status: PENDING -> RUNNING -> DONE / PARTIAL / FAILED
        |
        v
  Browser polls GET /api/profile/[id] every 5 seconds
  while status is PENDING or RUNNING
```

The six channels are defined in `lib/queue/config.ts`:
`research`, `linkedin`, `whatsapp`, `instagram`, `facebook`, `twitter`.

Message shape:

```
  { tag, taskId, contactId?, contact: CardData, timestamp }
```

`rawNotes` is stripped before publishing to keep messages small.

Because the worker is out of process, nothing in this repository ever writes
`status`, `attempts`, `completed`, `failed` or `enriched_at`.

---

## Locations and the map

The map needs coordinates for free-text address strings. Resolution has three
tiers:

```
  Tier 1   Postgres  LocationCache table
           keyed on a normalised query string. A miss is written back
           as resolved:true even when nothing was found, so a bad
           string is only ever looked up once.

  Tier 2   lib/location.ts  curated tables
           ~70 Indian cities plus a handful of international ones,
           with state and country lookup. Free, instant, no network.

  Tier 3   Nominatim  https://nominatim.openstreetmap.org/search
           Only when tiers 1 and 2 miss. Paced to about one request
           per second, and memoised in memory for the process lifetime.
```

The map loads in two phases so markers appear as soon as possible:

```
  Phase 1   one bulk call to POST /api/locations/cache-check
            -> known locations get markers straight away

  Phase 2   one POST /api/locations/resolve per missing location
            -> a progress bar fills as each one lands
```

The resolver is isomorphic: the same `lib/location.ts` runs in the browser (to
build the state and country filter dropdowns) and on the server (to geocode).

Map tiles come from Esri's public ArcGIS endpoints, with a street layer, a
satellite layer and a labels overlay. Leaflet's marker icons load from unpkg,
because the default icons break under bundlers.

---

## Tests and quality gates

88 tests across 7 files, run with `npm test`. They run fully offline: no live
OpenAI key, no RabbitMQ, no internet. Prisma and the external clients are
replaced with fakes in `tests/setup.ts`.

```
  tests/
  |-- setup.ts                       Offline env + Prisma/RabbitMQ fakes
  |-- helpers/session.ts             Builds a real signed session cookie
  |-- smoke.test.ts                  Alias resolution, isolation
  |-- REQUIREMENT-MAP.md             Which test proves which requirement
  |-- security/
  |   |-- session-boundary.test.ts   401 for anonymous, 200 with a session
  |   |-- route-enumeration.test.ts  Walks app/api off disk, no stale lists
  |   |-- role-boundary.test.ts      401 before 403; DEVELOPER is not ADMIN
  |   |-- cookie-integrity.test.ts   Tampered / forged / expired cookies
  |   `-- requirements-coverage.test.ts
  |                                   Fails when a requirement claim rots
  `-- ci/deploy-workflow.test.ts     The gates must block the build
```

Two of these are worth calling out:

- **`route-enumeration.test.ts` reads the filesystem.** It walks `app/api/**`
  and asserts every discovered route is either on the public allowlist or calls
  the guard. Adding a new endpoint without a guard fails the suite, and no
  hand-maintained list can go stale.
- **`requirements-coverage.test.ts` reads `REQUIREMENT-MAP.md` and reads the
  named test files back off disk.** Renaming a test turns the table red.

CI runs on every push to `main`:

```
  verify          typecheck, lint, test. Blocks everything below it.
     |
     v
  build-and-push  Buildx builds the Dockerfile, pushes to GHCR
                  as :latest and :<short-sha>
     |
     v
  deploy          self-hosted runner, Windows PowerShell, D:/card-scanner
                  docker compose pull -> up -d -> prune old images
```

---

## Deployment

Three-stage Docker build, `output: "standalone"`, container runs
`node server.js` on port 4111.

```
  Stage 1   npm ci with a BuildKit cache mount
  Stage 2   npx prisma generate + npm run build, with a dummy DATABASE_URL
            so the build never needs a live database
  Stage 3   copies .next/standalone, .next/static and public/ only.
            Runs as the unprivileged "node" user.
```

`docker-compose.yml` pulls `ghcr.io/laser-power-infra/card_scanner:${APP_VERSION:-latest}`,
maps `4111:4111`, reads `.env.production`, and joins the external Docker
network `infra`. Postgres and RabbitMQ are pre-existing services on that same
network -- they are not in this compose file.

The image build hard-fails without `package-lock.json`, so keep the lockfile
committed.

Migrations are **not** run by the container or by CI. `npx prisma migrate
deploy` is an operator step.

---

## Maintenance scripts

All three are read-only by default and print a plan instead of writing.

| Script | Run with | Does |
|--------|----------|------|
| `scripts/dedupeContacts.ts` | `npx tsx scripts/dedupeContacts.ts` | Report duplicate contacts by email, then mobile, then telephone, then name + company. |
| `scripts/backfill-location.ts` | `npm run backfill:location` | Fill in a missing `state` on stored contacts from their address. |
| `scripts/phone-fields.ts` | `npx tsx scripts/phone-fields.ts` | Split phone arrays into mobiles and landlines using Indian numbering rules. |

Pass `--dry-run` to the ones that support it to see the plan without touching
the database.

---

## Known gaps

Things that are true today and worth knowing before you build on this.

- **Auth config is defined twice.** `lib/auth.ts` and
  `app/api/auth/[...nextauth]/route.ts` each define a full `NextAuthOptions`
  object, and they have already drifted (one trims and lowercases the email,
  the other does not). Tracked as STR-03, deferred.
- **No password-reset email.** `/api/auth/forgot-password` prints the reset
  link to the server console **and returns it in the response body**, so
  anyone who knows an email can reset that account. There is a `TODO` to add a
  mail provider. This is the highest-priority thing on the list.
- **Password rules disagree.** Registration requires 8 characters, reset
  requires 6.
- **No tenant model.** `Contact` has no `userId`. Every signed-in user sees and
  edits the same global contact list. Access is role-based only, never
  user-scoped.
- **Four near-duplicate geocode endpoints.** Two of them have no caller at
  all. Tracked as HYG-02.
- **Dead code.** `lib/permissions.ts` still exports helpers nothing calls
  (`requireAuth`, `requireAdmin`, `isAdmin`, `isDeveloper`, `isOwner`).
  `components/ProtectedRoute.tsx`, `RoleGuard.tsx`, `ProfileModal.tsx`,
  `LoginForm.tsx` and `RegisterForm.tsx` have no importer.
- **Two OpenAI clients.** `lib/extractCard.ts` and
  `app/api/profile/enrich/route.ts` each build their own client and each
  hardcode the model name, token cap and response format. A model change means
  editing two files.
- **No rate limiting** on `/api/scan` or the geocode endpoints. Both spend
  money. Phase 3 of the roadmap addresses this.
- **Sensitive values reach the logs.** The RabbitMQ connection string (with
  its password), extracted card PII, and the password-reset link are all
  printed to stdout.
- **`/dashboard`, `/directory` and `/admin` are placeholders.** They render
  hardcoded numbers. The navbar links to them are commented out.
- **No error boundary.** There is no `app/error.tsx`. A render-time throw in a
  client component shows the framework default screen.
- **`README.md` mentions no test suite in the architecture it was built
  against.** The Vitest harness and the CI verify job landed in Phase 1 of the
  roadmap and are documented above.
