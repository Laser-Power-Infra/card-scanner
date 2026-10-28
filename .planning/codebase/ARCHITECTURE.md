<!-- refreshed: 2026-10-03 -->
# Architecture

**Analysis Date:** 2026-10-03

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                         │
│  app/page.tsx (SPA shell) + components/*.tsx (13 components)  │
│  app/layout.tsx (root layout, fonts, AuthProvider, Navbar)    │
│  context/AuthProvider.tsx (SessionProvider wrapper)           │
└────────┬────────────────────────────────────────────────────┘
         │ fetch() / signIn() / signOut()
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Layer (Route Handlers)                 │
│  app/api/scan/route.ts        — image + spreadsheet ingest    │
│  app/api/contacts/route.ts    — paginated contact list        │
│  app/api/contacts/[id]/route.ts — single contact update       │
│  app/api/contacts/batch/route.ts — bulk contact update        │
│  app/api/profile/[id]/route.ts — single contact + enrichment  │
│  app/api/profile/enrich/route.ts — synchronous LLM research   │
│  app/api/locations/*/route.ts — 4 geocoding endpoints         │
│  app/api/auth/*/route.ts      — NextAuth + register/reset    │
│  app/api/health/route.ts      — liveness probe                │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Server Actions Layer                       │
│  app/actions/profile-collection.ts — DEVELOPER-gated queue   │
│  publishProfileCollection() / researchAllContacts()          │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Library Layer (lib/)                       │
│  lib/extractCard.ts    — OpenAI vision card extraction       │
│  lib/location.ts       — offline city/state tables + Nominatim│
│  lib/prisma.ts         — PrismaClient singleton (globalThis) │
│  lib/rabbitmq.ts       — RabbitMQ connection singleton       │
│  lib/queue/            — queue config + publisher            │
│  lib/auth.ts           — NextAuth options (JWT strategy)     │
│  lib/permissions.ts    — Role enum, requireApiSession/Role   │
│  lib/resizeImage.ts    — client-side image downscale         │
│  lib/contact.ts        — vCard download, initials, URLs      │
│  lib/validation.ts     — contact field validation            │
│  lib/draftStorage.ts   — localStorage edit drafts           │
│  lib/httpsCheck.ts     — HTTPS enforcement helper            │
│  lib/rateLimit.ts      — in-memory rate limiter              │
│  lib/scriptAudit.ts    — script audit trail                  │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Layer                                │
│  prisma/schema.prisma  — Contact, User, Enrichment,          │
│                          PasswordResetToken, LocationCache    │
│  prisma/migrations/    — 10 migration files                  │
│  lib/generated/prisma/ — generated client (gitignored)       │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  External Services                                           │
│  PostgreSQL (DATABASE_URL) — primary store                   │
│  OpenAI (OPENAI_API_KEY) — vision extraction + enrichment    │
│  RabbitMQ (RABBITMQ_URL) — async profile collection queue    │
│  Nominatim (HTTPS)        — geocoding fallback               │
│  Esri ArcGIS (HTTPS)      — map tiles                        │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Edge middleware | Route gating for dashboard/directory/admin; admin role check; logged-in redirect away from auth pages; force-reset redirect for mustResetPassword users | `middleware.ts` |
| Root layout | Font variables (Fraunces, Geist, Geist Mono), `SessionProvider`, global `Navbar` — the only server component | `app/layout.tsx` |
| Home page (SPA shell) | Contact state, file upload orchestration, client-side search/filter/pagination, 3 view modes (cards/table/map), vCard export, edit mode with localStorage drafts | `app/page.tsx` |
| Scan route | Multipart intake; branches image → OpenAI vision, spreadsheet → XLSX parse; dedupe-or-merge upsert; fire-and-forget location pre-cache + research publish | `app/api/scan/route.ts` |
| Card extraction | System prompt, OpenAI vision call, fenced-JSON unwrap, defensive field coercion | `lib/extractCard.ts` |
| Contacts API | Cursor-based pagination of every contact incl. `enrichment.status`, newest first | `app/api/contacts/route.ts` |
| Contact update API | Single contact PATCH with validation | `app/api/contacts/[id]/route.ts` |
| Batch contact update API | Bulk PATCH with per-item validation | `app/api/contacts/batch/route.ts` |
| Profile API | Single contact + enrichment read (the client polls this while status is PENDING/RUNNING) | `app/api/profile/[id]/route.ts` |
| Enrich route | Synchronous LLM "web research" returning `EnrichedProfile`; not persisted | `app/api/profile/enrich/route.ts` |
| Location APIs | 4 overlapping endpoints that consult `LocationCache` then resolve coordinates | `app/api/locations/{route.ts,batch/route.ts,resolve/route.ts,cache-check/route.ts}` |
| Location resolver | Offline curated city→state/country/coords tables + paced Nominatim fallback + in-process cache | `lib/location.ts` |
| RabbitMQ client | Module-level connection/channel singleton, auto-nulling on error/close | `lib/rabbitmq.ts` |
| Queue publisher | Strips `rawNotes`, asserts durable queue, `sendToQueue` persistent message | `lib/queue/profileCollection.ts` |
| Queue config | Queue name `CS-profile:collection` and the `ProfileTag` union | `lib/queue/config.ts` |
| Server actions | DEVELOPER-gated publish of a single task or of all contacts | `app/actions/profile-collection.ts` |
| Auth config (lib) | NextAuth options used by server actions and `lib/permissions.ts` | `lib/auth.ts` |
| Auth config (route) | A second, divergent copy of NextAuth options used by the actual NextAuth handler | `app/api/auth/[...nextauth]/route.ts` |
| Permission helpers | `Role` enum, `requireApiSession`, `requireApiRole`, `getCurrentSession`, `PUBLIC_API_PATHS` | `lib/permissions.ts` |
| Prisma client | Global-cached `PrismaClient` with a `PrismaPg` driver adapter | `lib/prisma.ts` |
| Map view | Leaflet map, Esri tiles, geolocation watch, 2-phase location resolution with progress UI | `components/ContactMap.tsx` |
| Table view | Client-side dedupe, 8-axis multi-select filtering, pagination | `components/ContactTable.tsx` |
| Card view | Paginated grid (100/page) of `ContactCard` | `app/page.tsx:417-508` |
| Slide-over profile | Polls `/api/profile/[id]` every 5s while enrichment is PENDING/RUNNING; renders rich text | `components/ProfileSlideOver.tsx` |
| Rich-text renderers | Linkify, bullet blocks, labelled links, source lists, WhatsApp extraction | `components/ProfileRichText.tsx` |
| Shared types | `CardData`, `EnrichedProfile`, `DuplicateEntry`, `ScanResponse` | `types/card.ts` |
| NextAuth type aug | Adds `id`, `role`, `mustResetPassword` to `Session`, `User`, `JWT` | `types/next-auth.d.ts` |
| Dedupe script | Read-only report of duplicate contacts by email → mobile → tel → name+company | `scripts/dedupeContacts.ts` |
| Dashboard page | Stats cards, quick links, recent activity | `app/dashboard/page.tsx` |
| Contact profile page | Server-rendered single contact with enrichment display | `app/contacts/[id]/page.tsx` |
| Auth pages | Login, register, forgot-password, reset-password, force-reset | `app/{login,register,forgot-password,reset-password,force-reset}/page.tsx` |

## Pattern Overview

**Overall:** Client-side SPA with API route handlers as the business logic layer

**Key Characteristics:**
- **No RSC data layer.** Every `app/**/page.tsx` begins with `"use client"` and holds its own `useState`. Initial data always arrives via `fetch()` from a `useEffect` (`app/page.tsx:66-93`). There are no `async` server page components, no `loading.tsx`/`error.tsx` boundaries, and no `Suspense` streaming.
- **Route handlers own the business logic.** Validation, dedupe/merge, geocode orchestration and AI prompting are written inline inside `app/api/**/route.ts` rather than extracted into `lib/`.
- **Fire-and-forget queueing.** Both `pushResearchTask` (`app/api/scan/route.ts:126`) and `publishProfileCollectionTask` (`lib/queue/profileCollection.ts:53`) swallow failures. A missing RabbitMQ yields a logged warning and a successful HTTP response.
- **Client-authoritative state.** The database is a dumb store; the browser holds the full contact list, and all filtering/sorting/dedup for the UI happens client-side.
- **Enrichment is a polling contract.** The web app publishes to RabbitMQ; an external worker writes `Contact.enrichment`; the browser discovers this by polling `/api/profile/[id]` every 5s (`components/ProfileSlideOver.tsx:128-137`).

## Layers

**Presentation Layer:**
- Purpose: All UI. Owns user state and calls the API.
- Location: `app/page.tsx`, `app/dashboard/page.tsx`, `app/contacts/[id]/page.tsx`, `app/login/page.tsx`, `app/register/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `app/force-reset/page.tsx`, `components/*.tsx`, `context/AuthProvider.tsx`
- Contains: `"use client"` modules, Tailwind classes, `useState`/`useMemo`/`useCallback`/`useRef`
- Depends on: `next-auth/react`, `@/types/*`, `@/lib/location` (pure functions), `@/lib/resizeImage`, `@/app/actions/*` (server actions), route handlers via `fetch`
- Used by: nothing else — this is the top layer

**API Layer:**
- Purpose: Request parsing, input validation, orchestration, JSON response shaping.
- Location: `app/api/**/route.ts`
- Contains: exported `GET`/`POST`/`PATCH` functions returning `NextResponse.json(...)`; `export const runtime`/`maxDuration` in `app/api/scan/route.ts:37-38`
- Depends on: `@/lib/*`, `@/types/*`, `@/lib/generated/prisma`
- Used by: Presentation layer only

**Server Actions Layer:**
- Purpose: The single privileged, DEVELOPER-gated mutating path into the queue.
- Location: `app/actions/profile-collection.ts` (`"use server"` at line 1)
- Contains: `publishProfileCollection()`, `researchAllContacts()`
- Depends on: `getServerSession(authOptions)`, `prisma`, `publishProfileCollectionTask`
- Used by: `components/ProfileCollectionButtons.tsx:40`, `components/ResearchAllButton.tsx:27`

**Library Layer:**
- Purpose: Reusable logic shared by more than one caller, or too heavy for a route handler.
- Location: `lib/auth.ts`, `lib/extractCard.ts`, `lib/location.ts`, `lib/prisma.ts`, `lib/rabbitmq.ts`, `lib/queue/*`, `lib/resizeImage.ts`, `lib/permissions.ts`, `lib/contact.ts`, `lib/validation.ts`, `lib/draftStorage.ts`, `lib/httpsCheck.ts`, `lib/rateLimit.ts`, `lib/scriptAudit.ts`
- Contains: prompt strings, lookup tables, Prisma/RabbitMQ client bootstraps, pure functions (`deriveStateCountry`, `resolveLocationCoords`, `resizeImageFile`)
- Depends on: Postgres, RabbitMQ, OpenAI, Nominatim
- Used by: Route handlers, server actions, `app/page.tsx`

**Data Layer:**
- Purpose: Postgres access and schema definition.
- Location: `prisma/schema.prisma`, `prisma/migrations/*`, `lib/prisma.ts`, `lib/generated/prisma/*` (generated, gitignored)
- Contains: `Contact`, `User`, `Enrichment`, `PasswordResetToken`, `LocationCache`; `Role` and `EnrichmentStatus` enums
- Depends on: `@prisma/adapter-pg` driver adapter + `DATABASE_URL`
- Used by: `lib/auth.ts`, `lib/permissions.ts`, all route handlers, `app/actions/profile-collection.ts`, `scripts/dedupeContacts.ts`

## Data Flow

### Primary Request Path — image scan

1. User selects image in `UploadZone` → `handleFileSelected` (`app/page.tsx:185`)
2. Client resizes image via `resizeImageFile` (`lib/resizeImage.ts:9`), then `fetch("/api/scan", { method: "POST", body: formData })`
3. `app/api/scan/route.ts:179` `POST` receives form data, validates MIME + size
4. `extractCardFromImage(base64, file.type)` (`lib/extractCard.ts:64`) calls OpenAI vision
5. Dedupe check: `prisma.contact.findFirst` with OR clauses on emails/phones/name+company
6. If new: `prisma.contact.create` → `preCacheLocation` → `pushResearchTask` → return created contact
7. If existing: merge new fields → `prisma.contact.update` → `preCacheLocation` → `pushResearchTask` → return merged contact
8. Client receives `ScanResponse`, updates `contacts` state, shows result

### Secondary Flow — enrichment lifecycle (publish → poll → render)

1. `pushResearchTask` (`app/api/scan/route.ts:126`) or `publishProfileCollection` (`app/actions/profile-collection.ts:23`) publishes to RabbitMQ queue `CS-profile:collection`
2. External worker (different repo) consumes, researches, writes `Enrichment` row
3. Client opens `ProfileSlideOver` → polls `/api/profile/[id]` every 5s (`components/ProfileSlideOver.tsx:128-137`)
4. When `enrichment.status` is `DONE`/`PARTIAL`/`FAILED`, polling stops and rich profile renders

### Tertiary Flow — map geocoding (two-phase, progressive)

1. `ContactMap` mounts, resolves each contact's location via `resolveLocationCoords` (`lib/location.ts:464`)
2. Phase 1: offline `CITY_COORDS` table lookup — instant, no network
3. Phase 2: `geocodeFallback` → Nominatim API with 1.1s pacing (`lib/location.ts:435`)
4. Results cached in `LocationCache` table + in-process `GEOCODE_CACHE` Map
5. Markers placed on Leaflet map with Esri tiles

### Quaternary Flow — list read

1. `app/page.tsx:74` `loadContacts` fetches `/api/contacts` (cursor-based pagination, 100/page)
2. `app/api/contacts/route.ts:7` `GET` queries `prisma.contact.findMany` with cursor
3. Client appends to `contacts` state, derives `stateOptions`/`countryOptions` via `useMemo`
4. `filteredContacts` computed via `JSON.stringify` search + state/country filters
5. Paginated into `paginatedCards` (100/page) for card view, or passed to `ContactTable`

**State Management:**
- React `useState` inside page components is the single source of truth. `app/page.tsx` holds 12 state variables (`:48-61`) covering scan status, contacts, search, filters, view mode, pagination, and the slide-over.
- Derived data is `useMemo`, not stored: `stateOptions`/`countryOptions` (`app/page.tsx:119`), `filteredContacts` (`app/page.tsx:138`), `paginatedCards` (`app/page.tsx:161`).
- `context/AuthProvider.tsx` is a thin `SessionProvider` wrapper (5-minute `refetchInterval`, refetch on window focus). There is **no** global state library — no Redux, Zustand, Jotai or React Query.
- Leaflet instances and markers are held in `useRef` (`components/ContactMap.tsx:66-69`), not in context.
- `app/page.tsx:84-92` deliberately refetches only on a bfcache `pageshow` with `e.persisted`, not on every focus.

## Key Abstractions

**CardData DTO:**
- Purpose: One interface that crosses every boundary: LLM output, Prisma row, route-handler JSON, client component props, and RabbitMQ message body.
- Examples: `types/card.ts:1`, `lib/extractCard.ts:2`, `app/api/scan/route.ts:4`, `components/ContactCard.tsx:13`, `components/ContactTable.tsx:3`, `lib/queue/profileCollection.ts:3`
- Pattern: Shared DTO. Its `id` is optional (absent pre-persistence), and it carries a narrowed `enrichment?: { status: string | null }` slice that `app/api/contacts/route.ts` includes but the LLM never produces.

**ProfileTag command:**
- Purpose: Tagged work contract between this app and the out-of-repo consumer.
- Examples: `lib/queue/profileCollection.ts:5`, `app/api/scan/route.ts:141-163`, `app/actions/profile-collection.ts:50-56`
- Pattern: Command message. `ProfileTag` is a discriminated string union (`lib/queue/config.ts:14`) so a consumer can route on `tag`.

**LocationResolver:**
- Purpose: Turn free-text address fragments into `{state, country}` for filtering and `[lat,lng]` for the map, with no per-request cost for known cities.
- Examples: `lib/location.ts:285`, `lib/location.ts:290`, `lib/location.ts:464`; consumed by `app/page.tsx:100`, `app/api/scan/route.ts:17`, and all 4 location routes
- Pattern: Static-table lookup with longest-match-wins substring matching, plus a network fallback behind a rate limiter. Pure and isomorphic — the same module runs in the browser (for filters) and on the server (for geocoding).

**EnrichmentStatus state machine:**
- Purpose: Expose worker progress to the UI so polling knows when to stop.
- Examples: `prisma/schema.prisma:72-78`, mapped to pill colours in `components/ProfileSlideOver.tsx:14-20`, checked at `components/ProfileSlideOver.tsx:130`, and queried at `app/actions/profile-collection.ts:126-133` for `not_done` mode
- Pattern: Database-enum-as-state-machine. `PENDING|RUNNING` = keep polling; `DONE|PARTIAL|FAILED` = terminal.

**FIELD_ALIASES:**
- Purpose: Fuzzy-map arbitrary CSV/XLSX headers onto `Contact` fields.
- Examples: `app/api/scan/route.ts:63-74`, with `normalizeHeader` (`:76`), `mapHeader` (`:80`), `headerToField` (`:84`)
- Pattern: Alias table + longest/earliest-match resolver, case/punctuation insensitive, first-wins per field, arrays collect all matching columns.

## Entry Points

**Middleware:**
- Location: `middleware.ts`
- Triggers: Every request matching `middleware.ts:61-67` (`/dashboard/:path*`, `/directory/:path*`, `/admin/:path*`, `/login`, `/register`)
- Responsibilities: `withAuth` gate, `token.role !== "ADMIN"` redirect for `/admin`, redirect logged-in users off `/login` and `/register`, force-reset redirect for `mustResetPassword` users
- Note: the `authorized` callback inside (`:33-51`) also whitelists `/`, `/forgot-password`, `/reset-password`, `/api/auth` — but the `matcher` never routes those paths here, so that whitelist is dead code.

**Root Layout:**
- Location: `app/layout.tsx:43`
- Triggers: Every route
- Responsibilities: next/font variable wiring, `AuthProvider` → `Navbar` → `{children}` shell, site `metadata`

**Home Page:**
- Location: `app/page.tsx:50`
- Triggers: Navigation to `/` (the only unauthenticated, fully-featured page)
- Responsibilities: upload orchestration, contact list state, 3 view modes, search/state/country filters, pagination, vCard export, duplicate notices, edit mode with localStorage drafts

**API Routes:**
- `app/api/scan/route.ts` — `GET` health probe (`:172`), `POST` ingest (`:179`)
- `app/api/contacts/route.ts` — `GET` list with cursor pagination
- `app/api/contacts/[id]/route.ts` — `PATCH` single contact update
- `app/api/contacts/batch/route.ts` — `PATCH` bulk contact update
- `app/api/profile/[id]/route.ts` — `GET` one contact + enrichment (awaited `params` promise, Next 15 signature)
- `app/api/profile/enrich/route.ts` — `POST` LLM research
- `app/api/locations/route.ts`, `app/api/locations/batch/route.ts`, `app/api/locations/resolve/route.ts`, `app/api/locations/cache-check/route.ts` — `POST` geocode
- `app/api/auth/[...nextauth]/route.ts` — `GET`/`POST` NextAuth
- `app/api/auth/register/route.ts`, `forgot-password/route.ts`, `reset-password/route.ts`, `confirm-reset/route.ts`, `force-reset/route.ts` — `POST` account flows
- `app/api/health/route.ts` — `GET` liveness, `Access-Control-Allow-Origin: *`

**Server Actions:**
- Location: `app/actions/profile-collection.ts`
- Triggers: `components/ProfileCollectionButtons.tsx:40` (single task), `components/ResearchAllButton.tsx:27` (bulk)
- Responsibilities: DEVELOPER role gate, tag validation, payload assembly, queue publish, result tallying

**Scripts:**
- Location: `scripts/dedupeContacts.ts:6` `main()`
- Triggers: Manual `pnpm tsx scripts/dedupeContacts.ts`
- Responsibilities: read-only duplicate report; explicitly performs no destructive action (`:4`, `:31`)

**CI/CD:**
- Location: `.github/workflows/deploy.yml`
- Triggers: push to `main`
- Responsibilities: verify (typecheck + lint + test) → build 3-stage Docker image → push to GHCR → self-hosted runner pulls and `docker compose up -d` → prune old images keeping the last two

## Architectural Constraints

- **Threading:** Single Node.js process on the event loop. `/api/scan` pins `export const runtime = "nodejs"` (`app/api/scan/route.ts:37`) and `maxDuration = 60` (`:38`) for the OpenAI round-trip. No worker threads, no `sharp`/WASM offload. `openai`, `xlsx`, `amqplib` and `pg` are all main-thread. Long CPU work (XLSX parse at `app/api/scan/route.ts:203`) blocks the loop. The only deliberate pacing is the `setTimeout` sleep in `lib/location.ts:442-443` and the Leaflet render loop in the browser.
- **Global state:** Six module-level mutable singletons: `lib/prisma.ts:6-22` (PrismaClient on globalThis), `lib/rabbitmq.ts:3-4` (model + channel), `lib/location.ts:432-433` (GEOCODE_CACHE + lastGeocodeAt), `lib/rateLimit.ts:1` (rateLimits Map), `lib/extractCard.ts:75` (OpenAI client per call), `app/page.tsx:71-72` (objectUrlRef + cardScrollRef).
- **Circular imports:** None detected. The longest chain is `app/actions/profile-collection.ts` → `lib/queue/profileCollection.ts` → `lib/rabbitmq.ts`, and `app/actions/profile-collection.ts` → `lib/auth.ts` → `lib/prisma.ts` — both strictly acyclic. `lib/permissions.ts` → `lib/auth.ts` is one-directional. `components/ContactTable.tsx:4` imports `MultiSelectFilter` relatively (`./MultiSelectFilter`) while every other cross-directory import uses the `@/` alias.
- **No ownership/tenancy model:** `Contact` has no `userId` (`prisma/schema.prisma:15-44`) and no API route filters by session. Every authenticated user sees and mutates the same global contact set. Authorization today is role-based only (ADMIN for `/admin`, DEVELOPER for queue publishing), never user-scoped.
- **Enrichment is out-of-process:** `EnrichmentStatus` values are written by a consumer that does not live in this repository. Nothing in this codebase ever sets `status`, `attempts`, `completed`, `failed`, or `enriched_at` — see `prisma/schema.prisma:80-113` for fields with no in-repo writer.
- **Edge/runtime split:** `middleware.ts` runs on the Edge runtime and therefore cannot use Prisma or Node crypto; it relies purely on the JWT carried in the NextAuth cookie. The `NEXTAUTH_SECRET` used there comes from the `withAuth` default resolution, not from `lib/auth.ts`.
- **Form/JSON only, no uploads to disk:** images are base64-encoded in memory (`app/api/scan/route.ts:356`) and never persisted; `public/` holds only `.gitkeep`. The page footer asserts this at `app/page.tsx:603`.

## Anti-Patterns

### Unauthenticated API surface

**What happens:** `/api/scan`, `/api/contacts`, `/api/profile/[id]`, `/api/locations/resolve`, and `/api/locations/cache-check` are reachable without a session. The scan route is the most exposed — an anonymous caller can trigger billable OpenAI vision calls.
**Why it's wrong:** The 8MB cap and MIME allowlist are the only guardrails. There is no rate limiting, no CAPTCHA, no auth token. The `PUBLIC_API_PATHS` list in `lib/permissions.ts:53-72` documents this as "public by decision" but the decision is not enforced at runtime — it is only a test classifier.
**Do this instead:** Add a shared secret or API key check to the scan route, or move it behind `requireApiSession()`. If anonymous scanning is a product requirement, add per-IP rate limiting via `lib/rateLimit.ts`.

### Two divergent NextAuth configurations

**What happens:** `lib/auth.ts:7` exports `authOptions` used by server actions and `lib/permissions.ts`. `app/api/auth/[...nextauth]/route.ts:5` calls `NextAuth(authOptions)` — but the middleware's `withAuth` uses its own default resolution. The JWT callback in `lib/auth.ts:77-95` reads `user.role` and `user.mustResetPassword` with `as any` casts.
**Why it's wrong:** The `as any` casts at `lib/auth.ts:80-81,99-101` bypass TypeScript's type safety. If the `User` type changes, these casts silently break. The middleware's `authorized` callback (`middleware.ts:33-51`) duplicates the public-route list that also exists in `lib/permissions.ts:53-72`.
**Do this instead:** Remove the `as any` casts by properly typing the `User` return from `authorize()`. Consolidate the public-route list into a single source of truth.

### Business logic inlined in route handlers

**What happens:** `app/api/scan/route.ts` is 487 lines and contains spreadsheet parsing, header mapping, dedupe logic, merge logic, and research task publishing all inline. `app/api/profile/enrich/route.ts` is 154 lines with prompt construction and response normalization inline.
**Why it's wrong:** The handlers are difficult to test in isolation. The dedupe/merge logic in `app/api/scan/route.ts:370-468` is particularly dense — it handles emails, phones, name+company matching, field-level merging, and rawNotes JSON merging in a single block.
**Do this instead:** Extract the dedupe/merge logic into `lib/dedupe.ts` as a pure function. Extract the spreadsheet parsing into `lib/spreadsheet.ts`. Extract the enrichment prompt and normalization into `lib/enrich.ts`.

### Four near-duplicate location endpoints

**What happens:** `app/api/locations/route.ts`, `app/api/locations/batch/route.ts`, `app/api/locations/resolve/route.ts`, and `app/api/locations/cache-check/route.ts` all consult `LocationCache` and call `resolveLocationCoords`. They differ only in input shape (single vs batch) and whether they write to the cache.
**Why it's wrong:** The cache-check logic is duplicated across all four. The resolve logic is duplicated between `route.ts` and `resolve/route.ts`. Adding a new geocoding provider means editing four files.
**Do this instead:** Consolidate into a single `app/api/locations/route.ts` that accepts both single and batch requests, with a `writeCache` flag. Extract the cache-check logic into a shared helper.

### Two separate OpenAI client setups and prompt shapes

**What happens:** `lib/extractCard.ts:75` creates `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` with a card-extraction prompt. `app/api/profile/enrich/route.ts:94` creates `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` with a research prompt. Both use model `gpt-5.6-luna` and `max_tokens: 800`.
**Why it's wrong:** The OpenAI client is instantiated per-call in both places. The prompts are duplicated in structure (both ask for JSON, both have a system + user message). The response parsing is different (fenced-JSON unwrap vs direct parse).
**Do this instead:** Create `lib/openai.ts` that exports a singleton `getOpenAIClient()` and shared prompt builders. Extract the fenced-JSON unwrap into a shared `parseJsonResponse()` helper.

### Fat client page component

**What happens:** `app/page.tsx` is 799 lines and contains: upload orchestration, contact list state, search/filter/pagination, 3 view modes, vCard export, edit mode with localStorage drafts, duplicate notices, mobile dock, mobile scan sheet, and the slide-over profile.
**Why it's wrong:** The component is difficult to reason about. State updates in one area can unexpectedly affect others. The `handleFileSelected` callback (`app/page.tsx:185-283`) is 100 lines and handles both single and multi-file scans with merging logic.
**Do this instead:** Extract the scan flow into a `useScan()` hook. Extract the contact list state into a `useContacts()` hook. Extract the edit mode into a `useEditMode()` hook. Extract the mobile dock and scan sheet into separate components.

### Unused authorisation module with inline duplicates

**What happens:** `lib/permissions.ts` exports `isAuthenticated()`, `isAdmin()`, `isDeveloper()`, `requireAuth()`, `requireAdmin()`, `isOwner()` — but none of these are called anywhere in the codebase. The actual auth checks are done inline: `app/actions/profile-collection.ts:29` checks `session?.user?.role !== "DEVELOPER"` directly. `components/ProfileCollectionButtons.tsx:31` checks `session?.user?.role !== "DEVELOPER"` directly. `components/ResearchAllButton.tsx:17` checks `session.user.role !== "DEVELOPER"` directly.
**Why it's wrong:** The `Role` enum is defined in `lib/permissions.ts:6-10` but the inline checks use raw string literals `"DEVELOPER"` and `"ADMIN"`. If the role name changes, the inline checks break silently.
**Do this instead:** Replace inline role checks with `requireApiRole([Role.DEVELOPER])` or `isDeveloper()`. Remove the unused helpers or use them consistently.

## Error Handling

**Strategy:** Route handlers return, never throw. Every `POST`/`PATCH` wraps its body in `try` { … } `catch` and returns `NextResponse.json({ success:false, error: … }, { status })`.

**Patterns:**
- Status codes in use: `400` (bad input — `app/api/scan/route.ts:361`, `app/api/auth/reset-password/route.ts:41`), `401` (unauthenticated — `app/api/contacts/[id]/route.ts:12`, `app/api/contacts/batch/route.ts:9`), `403` (forbidden — `app/api/auth/forgot-password/route.ts:11`), `404` (`app/api/profile/[id]/route.ts:22`), `409` (email taken — `app/api/auth/register/route.ts:45`), `413` (too large — `app/api/scan/route.ts:345`), `415` (bad MIME — `app/api/scan/route.ts:334`), `500`, `502` (upstream empty — `app/api/profile/enrich/route.ts:120`).
- **Top-level catch re-throws the message.** `app/api/scan/route.ts:469-486` surfaces `err.message` verbatim to the browser.
- **Optional side effects get their own nested try/catch** so a cache or queue failure cannot fail the primary write — `app/api/scan/route.ts:32` (`preCacheLocation`), `:167` (`pushResearchTask`), `app/api/locations/resolve/route.ts:67` (cache upsert).
- **Outbound integrations degrade to `null`/`false` rather than throwing.** `lib/rabbitmq.ts:9,27,50` returns `null`; `lib/queue/profileCollection.ts:49` returns `false`; `lib/location.ts:459` swallows the Nominatim error; `lib/extractCard.ts:129` converts a `JSON.parse` failure into a descriptive `Error`.
- **Client state machine.** `app/page.tsx:31` `type Status = "idle" | "scanning" | "done" | "error"`; the catch at `:278-282` sets `errorMsg` and `status = "error"`, which renders the retry branch at `:707-736`. Other components hold an independent `error: string | null` (`components/ProfileSlideOver.tsx:35`, `components/ResearchAllButton.tsx:15`).
- **Deliberate cancellation.** `components/ProfileSlideOver.tsx:100,111,140` and `components/ContactMap.tsx` use a `cancelled` flag so in-flight fetches don't `setState` after unmount or after the open dialog closes.
- **Auth errors are opaque by design.** `lib/auth.ts:68-71` catches everything and returns `null`; `app/api/auth/forgot-password/route.ts:27-33` returns a success message for a non-existent email so the endpoint cannot be used to enumerate accounts. That same handler returns the reset link in the JSON body and on stdout (`:54-57, :63`) — a deliberate development affordance with a `TODO` at `:52` to swap in a mail provider.
- **No error boundary.** There is no `app/error.tsx`, no `global-error.tsx`, and no `error.tsx` anywhere. A render-time throw in a client component results in the framework default screen.

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.warn` / `console.error` with bracketed subsystem tags — `[Scan]`, `[RabbitMQ]`, `[Location API]`, `[Auth]`, `[ProfileCollection]`, `[Contacts]`, `[preCacheLocation]`. The tag is always the first argument. Unprefixed `console.error` also exists in auth routes. No structured logging, no log levels, no correlation IDs.

**Validation:** `lib/validation.ts` provides `validateContact(changes: Partial<CardData>): string | null` — checks name/company presence, email format, mobile number format. Used by `app/api/contacts/[id]/route.ts:18` and `app/api/contacts/batch/route.ts:16`. The scan route does inline validation (MIME type, size, name+company presence). No schema validation library (Zod/Valibot).

**Authentication:** NextAuth v4 with JWT session strategy. Credentials provider only. `lib/auth.ts` defines the options; `app/api/auth/[...nextauth]/route.ts` creates the handler. `middleware.ts` uses `withAuth` for route gating. `lib/permissions.ts` provides `requireApiSession()` and `requireApiRole()` for per-handler gates. Session shape augmented in `types/next-auth.d.ts` with `id`, `role`, `mustResetPassword`.

**Rate Limiting:** `lib/rateLimit.ts` provides an in-memory `Map<string, number>` with `isRateLimited(key, ttlMs)` and `setRateLimit(key, ttlMs)`. Used only by `app/api/auth/forgot-password/route.ts:7`. Not applied to the scan route or any other endpoint.

**HTTPS Enforcement:** `lib/httpsCheck.ts` provides `isHttps(req: NextRequest): boolean` — checks `x-forwarded-proto` header in production. Used by `app/api/auth/forgot-password/route.ts:10`, `app/api/auth/force-reset/route.ts:10`, `app/api/auth/confirm-reset/route.ts:7`.

---

*Architecture analysis: 2026-10-03*
