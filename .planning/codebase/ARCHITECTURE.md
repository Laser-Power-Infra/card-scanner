---
last_mapped_commit: 6d075c5e67e12a028a845bd113940e927aaa73c4
last_mapped_at: 2026-09-29
---
<!-- refreshed: 2026-09-29 -->

# Architecture

**Analysis Date:** 2026-09-29

## System Overview

A single Next.js 15 App Router application that acts as both the UI and the backend. There is no separate backend service: route handlers under `app/api/**/route.ts` are the API, and they call Postgres directly through Prisma. Every page is a client component; the only server-rendered React is `app/layout.tsx`.

```text
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (Client Components — every app/**/page.tsx is "use client")  │
│                                                                       │
│  app/page.tsx   UploadZone · ScannerStage · ContactCard · ContactTable │
│                 ContactMap · ProfileSlideOver · ProfileCollectionBtns  │
│                                                                       │
│  auth pages     login · register · forgot-password · reset-password    │
│  admin          admin · dashboard · directory (sample data, not wired) │
└───────────────┬───────────────────────────────┬───────────────────────┘
                │ fetch() from client          │ NextAuth SessionProvider
                │ /api/*                       │ (context/AuthProvider.tsx)
                ▼                               │
┌──────────────────────────────────────────────────────────────────────┐
│  Edge Middleware — middleware.ts (withAuth)                          │
│  matcher: /dashboard, /directory, /admin, /login, /register ONLY      │
└───────────────┬──────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Next.js Route Handlers (Node runtime)  +  Server Actions              │
│                                                                       │
│  app/api/scan/route.ts          image vision + spreadsheet import     │
│  app/api/contacts/route.ts      list all contacts (+enrichment)       │
│  app/api/profile/[id]/route.ts  single contact + enrichment            │
│  app/api/profile/enrich/route.ts  synchronous LLM research             │
│  app/api/locations/**/route.ts   4 near-duplicate geocode endpoints    │
│  app/api/auth/[...nextauth]      NextAuth v4 handler                  │
│  app/api/auth/{register,forgot-password,reset-password}  password mgmt│
│  app/actions/profile-collection.ts  "use server" DEVELOPER-only queue  │
└──────┬──────────────┬─────────────────┬────────────────┬──────────────┘
       │              │                 │                │
       ▼              ▼                 ▼                ▼
┌────────────┐ ┌────────────┐  ┌───────────────┐ ┌──────────────────┐
│ lib/       │ │ lib/queue/ │  │ lib/          │ │ Postgres         │
│ prisma.ts  │ │ profileCol-│  │ extractCard.ts│ │ via Prisma 7     │
│ (adapter-pg│ │ lection.ts │  │ location.ts   │ │ + @prisma/       │
│  singleton)│ │ + config.ts│  │ resizeImage.ts│ │   adapter-pg     │
└─────┬──────┘ └─────┬──────┘  └──────┬────────┘ └──────────────────┘
      │              │                │
      ▼              ▼                ▼
┌────────────┐ ┌────────────┐  ┌──────────────────┐
│ Postgres   │ │ RabbitMQ   │  │ OpenAI           │
│ Contact    │ │ queue      │  │ gpt-5.6-luna     │
│ User       │ │ "CS-profile│  │ (vision + json)  │
│ Enrichment │ │ :collection│  └──────────────────┘
│ Location   │ │  "         │  ┌──────────────────┐
│  Cache     │ └─────┬──────┘  │ Nominatim /      │
└────────────┘       │         │ Esri tile server │
                     │         └──────────────────┘
                     ▼
        ┌────────────────────────────┐
        │  RabbitMQ consumer worker  │
        │  (NOT in this repo)        │
        │  writes Contact.enrichment│
        └────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Edge middleware | Route gating for dashboard/directory/admin; admin role check; logged-in redirect away from auth pages | `middleware.ts` |
| Root layout | Font variables, `SessionProvider`, global `Navbar` — the only server component | `app/layout.tsx` |
| Home page (SPA shell) | Contact state, file upload orchestration, client-side search/filter/pagination, 3 view modes, vCard export | `app/page.tsx` |
| Scan route | Multipart intake; branches image → OpenAI vision, spreadsheet → XLSX parse; dedupe-or-merge upsert; fire-and-forget location pre-cache + research publish | `app/api/scan/route.ts` |
| Card extraction | System prompt, OpenAI vision call, fenced-JSON unwrap, defensive field coercion | `lib/extractCard.ts` |
| Contacts API | Unfiltered `findMany` of every contact incl. `enrichment`, newest first | `app/api/contacts/route.ts` |
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
| Permission helpers | `requireAuth` / `requireAdmin` / `isDeveloper` / `isOwner` — defined but never called | `lib/permissions.ts` |
| Prisma client | Global-cached `PrismaClient` with a `PrismaPg` driver adapter | `lib/prisma.ts` |
| Map view | Leaflet map, Esri tiles, geolocation watch, 2-phase location resolution with progress UI | `components/ContactMap.tsx` |
| Table view | Client-side dedupe, 8-axis multi-select filtering, pagination | `components/ContactTable.tsx` |
| Card view | Paginated grid (100/page) of `ContactCard` | `app/page.tsx:417-508` |
| Slide-over profile | Polls `/api/profile/[id]` every 5s while enrichment is PENDING/RUNNING; renders rich text | `components/ProfileSlideOver.tsx` |
| Rich-text renderers | Linkify, bullet blocks, labelled links, source lists, WhatsApp extraction | `components/ProfileRichText.tsx` |
| Shared types | `CardData`, `EnrichedProfile`, `DuplicateEntry`, `ScanResponse` | `types/card.ts` |
| NextAuth type aug | Adds `id` and `role` to `Session`, `User`, `JWT` | `types/next-auth.d.ts` |
| Dedupe script | Read-only report of duplicate contacts by email → mobile → tel → name+company | `scripts/dedupeContacts.ts` |

## Pattern Overview

**Overall:** Client-rendered SPA + Backend-for-Frontend route handlers over a single Prisma/Postgres connection, with an out-of-process RabbitMQ consumer for enrichment.

**Key Characteristics:**

- **No RSC data layer.** Every `app/**/page.tsx` begins with `"use client"` and holds its own `useState`. Initial data always arrives via `fetch()` from a `useEffect` (`app/page.tsx:66-93`). There are no `async` server page components, no `loading.tsx`/`error.tsx` boundaries, and no `Suspense` streaming.
- **Route handlers own the business logic.** Validation, dedupe/merge, geocode orchestration and AI prompting are written inline inside `app/api/**/route.ts` rather than extracted into `lib/`.
- **Fire-and-forget queueing.** Both `pushResearchTask` (`app/api/scan/route.ts:126`) and `publishProfileCollectionTask` (`lib/queue/profileCollection.ts:53`) swallow failures. A missing RabbitMQ yields a logged warning and a successful HTTP response.
- **Client-authoritative state.** The database is a dumb store; the browser holds the full contact list, and all filtering/sorting/dedup for the UI happens client-side.
- **Enrichment is a polling contract.** The web app publishes to RabbitMQ; an external worker writes `Contact.enrichment`; the browser discovers this by polling `/api/profile/[id]` every 5s (`components/ProfileSlideOver.tsx:128-137`).

## Layers

**Presentation (Client Components):**

- Purpose: All UI. Owns user state and calls the API.
- Location: `app/page.tsx`, `app/dashboard/page.tsx`, `app/directory/page.tsx`, `app/admin/page.tsx`, `app/login/page.tsx`, `app/register/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `components/*.tsx`, `context/AuthProvider.tsx`
- Contains: `"use client"` modules, Tailwind classes, `useState`/`useMemo`/`useCallback`/`useRef`
- Depends on: `next-auth/react`, `@/types/*`, `@/lib/location` (pure functions), `@/lib/resizeImage`, `@/app/actions/*` (server actions), route handlers via `fetch`
- Used by: nothing else — this is the top layer

**HTTP Boundary (Route Handlers):**

- Purpose: Request parsing, input validation, orchestration, JSON response shaping.
- Location: `app/api/**/route.ts`
- Contains: exported `GET`/`POST` functions returning `NextResponse.json(...)`; `export const runtime`/`maxDuration` in `app/api/scan/route.ts:37-38`
- Depends on: `@/lib/*`, `@/types/*`, `@/lib/generated/prisma`
- Used by: Presentation layer only

**Server Action Boundary:**

- Purpose: The single privileged, DEVELOPER-gated mutating path into the queue.
- Location: `app/actions/profile-collection.ts` (`"use server"` at line 1)
- Contains: `publishProfileCollection()`, `researchAllContacts()`
- Depends on: `getServerSession(authOptions)`, `prisma`, `publishProfileCollectionTask`
- Used by: `components/ProfileCollectionButtons.tsx:40`, `components/ResearchAllButton.tsx:27`

**Domain / Service Layer (`lib/`):**

- Purpose: Reusable logic shared by more than one caller, or too heavy for a route handler.
- Location: `lib/auth.ts`, `lib/extractCard.ts`, `lib/location.ts`, `lib/prisma.ts`, `lib/rabbitmq.ts`, `lib/queue/*`, `lib/resizeImage.ts`, `lib/permissions.ts`
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

1. File picked or dropped in `components/UploadZone.tsx:23-40`; the valid-image subset is rebuilt into a `DataTransfer` and handed to `onFileSelected`.
2. `app/page.tsx:161` `handleFileSelected` creates an object URL, sets `status = "scanning"`, and for each file calls `resizeImageFile` (`lib/resizeImage.ts:9`, max dim 1200px, JPEG q0.85) before POSTing `FormData` to `/api/scan` (`app/page.tsx:183`).
3. `app/api/scan/route.ts:179` `POST` reads `formData`, branches on MIME type, validates against `ALLOWED_IMAGE_TYPES` and `MAX_BYTES = 8MB` (`app/api/scan/route.ts:40-47`), and base64-encodes the buffer.
4. `lib/extractCard.ts:64` `extractCardFromImage` sends the image to `gpt-5.6-luna` with `detail: "high"` and `response_format: json_object` (`lib/extractCard.ts:80-111`), unwraps fenced JSON via `extractJson` (`lib/extractCard.ts:47`), and coerces every field to a known type (`lib/extractCard.ts:135-167`).
5. Dedupe query at `app/api/scan/route.ts:371-377` builds an `OR` of `emails has`, `mobileNumbers has`, `telephoneNumbers has`, and `AND[fullName, company]`. No match → `prisma.contact.create` (`:381`). Match → additive merge of only-new values into `fieldsToUpdate`, then `prisma.contact.update` (`:455`); if nothing new, the existing record is returned with `message: "duplicate_skipped"` (`:446`).
6. Side effects after write: `preCacheLocation` (`app/api/scan/route.ts:10`, calls `resolveLocationCoords` then upserts `LocationCache`) and `pushResearchTask` (`app/api/scan/route.ts:126` → `lib/queue/profileCollection.ts:53` → `lib/rabbitmq.ts:32` → `sendToQueue("CS-profile:collection", …, {persistent:true})`).
7. Response `{success, data, alreadyExists?, matchedBy?, message?}` returns to `app/page.tsx:188`. Multiple photos of the same card are merged client-side by a `reduce` over the results (`app/page.tsx:210-238`) — first non-empty scalar wins, list fields are `Set`-unioned.

### Secondary Flow — enrichment lifecycle (publish → poll → render)

1. `components/ProfileCollectionButtons.tsx:40` (or `components/ResearchAllButton.tsx:27`) calls the server action.
2. `app/actions/profile-collection.ts:23` verifies `session.user.role === "DEVELOPER"` (`:29`), validates the tag against `PROFILE_TAGS` (`:41`), generates a `randomUUID` taskId, and publishes.
3. The external RabbitMQ consumer (out of repo) writes the `Enrichment` row: `status` PENDING → RUNNING → DONE/PARTIAL/FAILED (`prisma/schema.prisma:64-103`).
4. `components/ProfileSlideOver.tsx:103` fetches `/api/profile/[id]`; `:128-137` re-arms a 5s `setTimeout` while `enrichment.status` is `PENDING` or `RUNNING`, and the cleanup at `:139-140` cancels in-flight work.
5. `app/api/profile/[id]/route.ts:11` reads `prisma.contact.findUnique({ where:{id}, include:{enrichment:true} })`. Rich-text fields are rendered by `components/ProfileRichText.tsx` (`BulletBlock`, `LabelledLinks`, `SourceLinks`, `Linkify`, `extractWhatsApp`).

### Tertiary Flow — map geocoding (two-phase, progressive)

1. `components/ContactMap.tsx:54` collects `companyLocation || address` from every contact and normalizes to lowercase.
2. **Phase 1** — one bulk call to `POST /api/locations/cache-check` (`components/ContactMap.tsx:253`). `app/api/locations/cache-check/route.ts:33` does a single `findMany({ where:{ query:{ in:[...] } } })`, seeds the client-side `SESSION_CACHE` (`components/ContactMap.tsx:52`, including negative caching) and returns `{cached, missing}`.
3. **Phase 2** — a `for` loop issues one `POST /api/locations/resolve` per missing query (`components/ContactMap.tsx:305-337`), updating `resolvingProgress` and appending markers as each resolves.
4. `app/api/locations/resolve/route.ts:20` reads `LocationCache`, else calls `resolveLocationCoords` (`lib/location.ts:464`): try the curated `CITY_COORDS` table offline first (`lib/location.ts:337`), then `geocodeFallback` (`lib/location.ts:435`) which paces itself to ~1 req/sec against `https://nominatim.openstreetmap.org/search` and memoises in `GEOCODE_CACHE`.
5. Every resolution — including a `null` result — is upserted with `resolved: true` so unresolvable strings are never re-queried (`app/api/locations/resolve/route.ts:50-63`).

### Quaternary Flow — list read

`app/page.tsx:66` `loadContacts` → `GET /api/contacts` → `app/api/contacts/route.ts:6` `prisma.contact.findMany({ include:{enrichment:true}, orderBy:{createdAt:"desc"} })`. The result lands in a single `useState` array (`app/page.tsx:51`) and is the substrate for all three view modes.

**State Management:**

- React `useState` inside page components is the single source of truth. `app/page.tsx` holds 12 state variables (`:48-61`) covering scan status, contacts, search, filters, view mode, pagination, and the slide-over.
- Derived data is `useMemo`, not stored: `stateOptions`/`countryOptions` (`app/page.tsx:95`), `filteredContacts` (`app/page.tsx:114`), `paginatedCards` (`app/page.tsx:142`).
- `context/AuthProvider.tsx` is a thin `SessionProvider` wrapper (5-minute `refetchInterval`, refetch on window focus). There is **no** global state library — no Redux, Zustand, Jotai or React Query.
- Leaflet instances and markers are held in `useRef` (`components/ContactMap.tsx:66-69`), not in context.
- `app/page.tsx:84-92` deliberately refetches only on a bfcache `pageshow` with `e.persisted`, not on every focus.

## Key Abstractions

**`CardData` — the universal contact shape:**

- Purpose: One interface that crosses every boundary: LLM output, Prisma row, route-handler JSON, client component props, and RabbitMQ message body.
- Examples: `types/card.ts:1`, `lib/extractCard.ts:2`, `app/api/scan/route.ts:4`, `components/ContactCard.tsx:13`, `components/ContactTable.tsx:3`, `lib/queue/profileCollection.ts:3`
- Pattern: Shared DTO. Its `id` is optional (absent pre-persistence), and it carries a narrowed `enrichment?: { status: string | null }` slice that `app/api/contacts/route.ts` includes but the LLM never produces.

**`ProfileCollectionTaskPayload` — the queue envelope:**

- Purpose: Tagged work contract between this app and the out-of-repo consumer.
- Examples: `lib/queue/profileCollection.ts:5`, `app/api/scan/route.ts:141-163`, `app/actions/profile-collection.ts:50-56`
- Pattern: Command message. `ProfileTag` is a discriminated string union (`lib/queue/config.ts:14`) so a consumer can route on `tag`.

**`LocationInput` / `resolveLocationCoords` — location resolution:**

- Purpose: Turn free-text address fragments into `{state, country}` for filtering and `[lat,lng]` for the map, with no per-request cost for known cities.
- Examples: `lib/location.ts:285`, `lib/location.ts:290`, `lib/location.ts:464`; consumed by `app/page.tsx:100`, `app/api/scan/route.ts:17`, and all 4 location routes
- Pattern: Static-table lookup with longest-match-wins substring matching, plus a network fallback behind a rate limiter. Pure and isomorphic — the same module runs in the browser (for filters) and on the server (for geocoding).

**`ProfileTag` / `PROFILE_TAGS` — capability vocabulary:**

- Purpose: The closed set of enrichment jobs (`research`, `linkedin`, `whatsapp`, `instagram`, `facebook`, `twitter`).
- Examples: `lib/queue/config.ts:5`, consumed by `ProfileCollectionButtons.tsx:60` for the button grid and `app/actions/profile-collection.ts:41` for validation
- Pattern: Const array → derived type → `Record<ProfileTag, string>` label map (`ProfileCollectionButtons.tsx:9`). Adding a channel means editing one file.

**`EnrichmentStatus` — the async state machine:**

- Purpose: Expose worker progress to the UI so polling knows when to stop.
- Examples: `prisma/schema.prisma:64`, mapped to pill colours in `components/ProfileSlideOver.tsx:14-20`, checked at `components/ProfileSlideOver.tsx:130`, and queried at `app/actions/profile-collection.ts:126-133` for `not_done` mode
- Pattern: Database-enum-as-state-machine. `PENDING|RUNNING` = keep polling; `DONE|PARTIAL|FAILED` = terminal.

**`FIELD_ALIASES` — spreadsheet column mapping:**

- Purpose: Fuzzy-map arbitrary CSV/XLSX headers onto `Contact` fields.
- Examples: `app/api/scan/route.ts:63-74`, with `normalizeHeader` (`:76`), `mapHeader` (`:80`), `headerToField` (`:84`)
- Pattern: Alias table + longest/earliest-match resolver, case/punctuation insensitive, first-wins per field, arrays collect all matching columns.

## Entry Points

**Edge Middleware:**

- Location: `middleware.ts`
- Triggers: Every request matching `middleware.ts:57-63` (`/dashboard/:path*`, `/directory/:path*`, `/admin/:path*`, `/login`, `/register`)
- Responsibilities: `withAuth` gate, `token.role !== "ADMIN"` redirect for `/admin`, redirect logged-in users off `/login` and `/register`
- Note: the `authorized` callback inside (`:34-51`) also whitelists `/`, `/forgot-password`, `/reset-password`, `/api/auth` — but the `matcher` never routes those paths here, so that whitelist is dead code.

**`RootLayout`:**

- Location: `app/layout.tsx:34`
- Triggers: Every route
- Responsibilities: next/font variable wiring, `AuthProvider` → `Navbar` → `{children}` shell, site `metadata`

**Home SPA:**

- Location: `app/page.tsx:47`
- Triggers: Navigation to `/` (the only unauthenticated, fully-featured page)
- Responsibilities: upload orchestration, contact list state, 3 view modes, search/state/country filters, pagination, vCard export, duplicate notices

**Route Handlers:**

- `app/api/scan/route.ts` — `GET` health probe (`:172`), `POST` ingest (`:179`)
- `app/api/contacts/route.ts` — `GET` list
- `app/api/profile/[id]/route.ts` — `GET` one contact + enrichment (awaited `params` promise, Next 15 signature)
- `app/api/profile/enrich/route.ts` — `POST` LLM research
- `app/api/locations/route.ts`, `app/api/locations/batch/route.ts`, `app/api/locations/resolve/route.ts`, `app/api/locations/cache-check/route.ts` — `POST` geocode
- `app/api/auth/[...nextauth]/route.ts` — `GET`/`POST` NextAuth
- `app/api/auth/register/route.ts`, `forgot-password/route.ts`, `reset-password/route.ts` — `POST` account flows
- `app/api/health/route.ts` — `GET` liveness, `Access-Control-Allow-Origin: *`

**Server Actions:**

- Location: `app/actions/profile-collection.ts`
- Triggers: `components/ProfileCollectionButtons.tsx:40` (single task), `components/ResearchAllButton.tsx:27` (bulk)
- Responsibilities: DEVELOPER role gate, tag validation, payload assembly, queue publish, result tallying

**Maintenance Script:**

- Location: `scripts/dedupeContacts.ts:3` `main()`
- Triggers: Manual `npx tsx scripts/dedupeContacts.ts`
- Responsibilities: read-only duplicate report; explicitly performs no destructive action (`:4`, `:31`)

**CI/CD:**

- Location: `.github/workflows/deploy.yml`
- Triggers: push to `main`
- Responsibilities: build 3-stage Docker image → push to GHCR → self-hosted runner pulls and `docker compose up -d` → prune old images keeping the last two

## Architectural Constraints

- **Threading:** Single Node.js process on the event loop. `/api/scan` pins `export const runtime = "nodejs"` (`app/api/scan/route.ts:37`) and `maxDuration = 60` (`:38`) for the OpenAI round-trip. No worker threads, no `sharp`/WASM offload. `openai`, `xlsx`, `amqplib` and `pg` are all main-thread. Long CPU work (XLSX parse at `app/api/scan/route.ts:199`) blocks the loop. The only deliberate pacing is the `setTimeout` sleep in `lib/location.ts:442-443` and the Leaflet render loop in the browser.
- **Global state:** Six module-level mutable singletons.
  - `lib/rabbitmq.ts:3-4` — `model` and `channel`, both nulled on `error`/`close`.
  - `lib/location.ts:432-433` — `GEOCODE_CACHE: Map` plus `lastGeocodeAt: number`. Per-process only; correctness across replicas depends entirely on the `LocationCache` table.
  - `components/ContactMap.tsx:52` — `SESSION_CACHE: Map` declared in a `"use client"` module, so it lives for the life of the loaded JS chunk, not the component.
  - `lib/prisma.ts:6-22` — client cached on `globalThis` to survive dev hot reloads.
  - `app/page.tsx:63` / `:64` — `objectUrlRef`, `cardScrollRef`.
  - `lib/extractCard.ts:75` / `app/api/profile/enrich/route.ts:90` — a fresh `new OpenAI(...)` per call rather than a module singleton.
- **Circular imports:** None detected. The longest chain is `app/actions/profile-collection.ts` → `lib/queue/profileCollection.ts` → `lib/rabbitmq.ts`, and `app/actions/profile-collection.ts` → `lib/auth.ts` → `lib/prisma.ts` — both strictly acyclic. `lib/permissions.ts` → `lib/auth.ts` is one-directional. `components/ContactTable.tsx:4` imports `MultiSelectFilter` relatively (`./MultiSelectFilter`) while every other cross-directory import uses the `@/` alias.
- **No ownership/tenancy model:** `Contact` has no `userId` (`prisma/schema.prisma:15-38`) and no API route filters by session. Every authenticated user sees and mutates the same global contact set. Authorization today is role-based only (ADMIN for `/admin`, DEVELOPER for queue publishing), never user-scoped.
- **Enrichment is out-of-process:** `EnrichmentStatus` values are written by a consumer that does not live in this repository. Nothing in this codebase ever sets `status`, `attempts`, `completed`, `failed`, or `enriched_at` — see `prisma/schema.prisma:74-98` for fields with no in-repo writer.
- **Edge/runtime split:** `middleware.ts` runs on the Edge runtime and therefore cannot use Prisma or Node crypto; it relies purely on the JWT carried in the NextAuth cookie. The `NEXTAUTH_SECRET` used there comes from the `withAuth` default resolution, not from `lib/auth.ts`.
- **Form/JSON only, no uploads to disk:** images are base64-encoded in memory (`app/api/scan/route.ts:352`) and never persisted; `public/` holds only `.gitkeep`. The page footer asserts this at `app/page.tsx:603`.

## Anti-Patterns

### Unauthenticated API surface

**What happens:** No route under `app/api/**` except the auth ones verifies a session. `app/api/contacts/route.ts`, `app/api/scan/route.ts`, `app/api/profile/[id]/route.ts`, `app/api/profile/enrich/route.ts`, and all four `app/api/locations/*` routes are fully open. `middleware.ts:57-63` matches only five page paths — `/api/*` is never in the matcher, so `withAuth` never runs for API traffic.

**Why it's wrong here:** `middleware.ts:34-51` explicitly whitelists `/api/auth` and requires a token for everything else, which reads as if API routes are covered. They are not. Any unauthenticated caller can enumerate every contact, trigger paid OpenAI vision calls through `/api/scan`, and trigger paid Nominatim traffic through `/api/locations/resolve`. The UI hides `/dashboard` and `/directory` behind the middleware, so the protection is cosmetic.

**Do this instead:** Copy the gate already used in `app/actions/profile-collection.ts:27`:

```ts
const session = await getServerSession(authOptions);
if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

at the top of each handler — or add `/api/:path*` to `middleware.ts:57-63` and drop `/api/auth` from the whitelist. Promote the logic into `lib/permissions.ts:48` `requireAuth()` rather than inlining a fourth variant.

### Two divergent NextAuth configurations

**What happens:** `lib/auth.ts:7-94` and `app/api/auth/[...nextauth]/route.ts:8-74` each define a complete `NextAuthOptions` object. The route-handler copy is the one NextAuth actually runs (and the one `withAuth` in `middleware.ts` implicitly mirrors); the `lib/` copy is used only by `app/actions/profile-collection.ts:5` and `lib/permissions.ts:2`. They have already drifted: the route version lowercases and trims the email (`route.ts:30`) while the lib version does not (`auth.ts:42`), the route version sets no `pages.error` while the lib version points it at `/login` (`auth.ts:14`), and the lib version returns `user.image` (`auth.ts:61`) which the route version omits (`route.ts:43-50`).

**Why it's wrong here:** Session shape is now ambiguous. A user whose email has trailing whitespace is rejected by the middleware-driven login path but would be accepted by the server-action session lookup, and vice-versa for `image`. Any future change to one file silently fails to apply to the other.

**Do this instead:** Delete the inline object in `app/api/auth/[...nextauth]/route.ts` and export the handler from the shared module:

```ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

Keep the two email-normalization behaviours reconciled explicitly, and add `role` to the returned `User` in `lib/auth.ts:58-64` so the casts at `auth.ts:77` and `auth.ts:85` can go away.

### Business logic inlined in route handlers

**What happens:** `app/api/scan/route.ts` is 425 lines containing a 12-key spreadsheet alias table (`:63-74`), four header-mapping helpers (`:76-124`), the duplicate-detection query builder (`:272-287` and again at `:371-377`), the merge-adapter (`:408-442`), and the queue payload builder (`:126-170`). None of it is reachable from anywhere except this one handler.

**Why it's wrong here:** The same dedupe rule is implemented three times with different shapes — the `OR`-clause builder in `/api/scan` (twice), the `makeKey` hierarchy in `components/ContactTable.tsx:48-56`, and the key hierarchy in `scripts/dedupeContacts.ts:17`. They do not agree: `/api/scan` treats any matching email/mobile/tel as a match, while `ContactTable` only looks at the *first* element of each array, and `dedupeContacts.ts` falls back differently again. A contact can therefore be merged server-side and still show twice in the table.

**Do this instead:** Extract to `lib/contacts.ts` — `buildDuplicateWhere(data): Prisma.ContactWhereInput`, `mergeIncoming(existing, incoming): Prisma.ContactUpdateInput`, and `dedupeKey(contact): string` — then have the route handler, the table, and the script all call the same functions. Put the spreadsheet alias table in `lib/spreadsheet.ts`.

### Four near-duplicate location endpoints

**What happens:** `app/api/locations/route.ts`, `app/api/locations/batch/route.ts`, `app/api/locations/resolve/route.ts` and `app/api/locations/cache-check/route.ts` each independently implement: normalize to lowercase → build a `Map` for dedup → query `LocationCache` → call `resolveLocationCoords` → upsert with `resolved: true`. `app/api/scan/route.ts:10` `preCacheLocation` is a fifth partial copy. The normalisation+dedup block at `cache-check/route.ts:10-22` is byte-for-byte the same as `batch/route.ts:11-23`.

**Why it's wrong here:** The four differ in observable behaviour — `locations/route.ts:20` returns a cache hit whenever a row exists regardless of `resolved`, while `resolve/route.ts:24` only short-circuits on `existing.resolved`. `batch/route.ts` persists but does not negative-cache differently, and `locations/route.ts` has no `query` echo. Two of the four have no caller at all: `app/api/locations/route.ts` and `app/api/locations/batch/route.ts` are unreferenced by any client.

**Do this instead:** Collapse to two endpoints — a `POST /api/locations/resolve` that takes `{locations: string[]}`, does cache-check then resolve-then-upsert internally, and returns `{resolved: Record<string, {lat,lng}>, missing: string[]}` (merging today's `cache-check` and `batch` responses). Update `components/ContactMap.tsx:253` and `:321` to the single call. Delete the uncalled routes. Move the shared body into `lib/location.ts` as `resolveMany(locations: string[])` so `app/api/scan/route.ts:10` can reuse it.

### Two separate OpenAI client setups and prompt shapes

**What happens:** `lib/extractCard.ts:75-111` and `app/api/profile/enrich/route.ts:90-110` each construct `new OpenAI({apiKey})`, each specify `model: "gpt-5.6-luna"`, `max_tokens: 800`, `response_format: {type:"json_object"}`. The enrichment route keeps its prompt as a module-level string (`:7-30`) and its coercion helpers (`safeString`, `normalizeProfile`, `normalizeSocialProfiles`, `:48-82`) inline in the route file. The scan path puts its equivalent coercions in `lib/extractCard.ts:135-167`.

**Why it's wrong here:** Model, token cap and response format can only be changed in two places, and the two will drift. The `gpt-5.6-luna` identifier does not correspond to any published OpenAI model, so a model change requires reading two files. `extractJson` (fenced-block unwrapping), which the scan path needs, is absent from the enrich path.

**Do this instead:** Add `lib/openai.ts` exporting a lazily-created singleton client and shared `chatJson(messages, opts)` that sets model/tokens/`response_format` and runs `extractJson` + `JSON.parse`. Move the enrich prompt and `normalizeProfile` into `lib/enrichProfile.ts` alongside `lib/extractCard.ts`, and reference the model name through one `const OPENAI_MODEL` so the README's cost-tuning instructions (`README.md:74-91`, which still describe `gpt-4o-mini` and `detail: "low"`) have something to point at.

### Fat client page component

**What happens:** `app/page.tsx` is 616 lines and owns: the contact fetch and bfcache listener (`:66-93`), facet derivation (`:95-112`), filtering (`:114-129`), card pagination maths (`:136-147`), object-URL lifecycle (`:149-159`), the image multi-upload loop and client-side merge reducer (`:161-259`), the spreadsheet import path (`:261-307`), vCard serialisation and Blob download (`:310-336`), and the entire three-mode render tree (`:338-614`). The parallel `app/directory/page.tsx:32-55` duplicates the directory concept against hardcoded `sampleContacts` and is unreachable from the navbar (the links are commented out at `components/Navbar.tsx:35-47`).

**Why it's wrong here:** Every new view mode or filter touches the same file; there is no place to test the merge reducer or the vCard builder in isolation; and the two directory implementations disagree on data source (live `/api/contacts` vs. two literals), so a reader cannot tell which is canonical.

**Do this instead:** Extract `useContacts()` (fetch + bfcache refetch), `useContactFilters(contacts)` (search + state/country facets), `mergeScannedCards(cards: CardData[]): CardData` (the reducer at `:210`), and `buildVCard(result): string` into `lib/` or a `hooks/` directory. Reduce `app/page.tsx` to composition. Point `app/directory/page.tsx` at the real `useContacts()` and delete `sampleContacts`.

### Unused authorisation module with inline duplicates

**What happens:** `lib/permissions.ts` exports `getCurrentSession`, `isAuthenticated`, `isAdmin`, `isDeveloper`, `requireAuth`, `requireAdmin` and `isOwner`. Nothing in the repo imports it. Meanwhile the role check is re-implemented as a literal string comparison in five places: `middleware.ts:12` (`token?.role !== "ADMIN"`), `app/actions/profile-collection.ts:29` and `:110` (`!== "DEVELOPER"`), `components/ProfileCollectionButtons.tsx:31` and `components/ResearchAllButton.tsx:17` (client-side, same check), and `components/Navbar.tsx:14`. `Role` is declared a second time in `lib/permissions.ts:4-8` in addition to the Prisma enum at `prisma/schema.prisma:40-44`.

**Why it's wrong here:** A dead module reads as the sanctioned place to ask "who is this?", so a future change is likely to be written there and never take effect. The duplicated `Role` enum has no compile-time link to the Prisma enum, so renaming a role in the schema breaks the helpers silently.

**Do this instead:** Either delete `lib/permissions.ts`, or make it the single source: have the server actions and every route handler call `requireAdmin()`/`requireAuth()` from it, re-export the Prisma `Role` enum instead of redeclaring it, and keep the two client-side `DEVELOPER` checks as a display-only gate explicitly commented as such. Note the client checks are advisory only — they hide buttons, they do not authorise anything, since the real gate is `app/actions/profile-collection.ts:29`.

## Error Handling

**Strategy:** Ad-hoc `try`/`catch` at each boundary, funnelled into a JSON error envelope. There is no error class hierarchy, no result type, and no central handler.

**Patterns:**

- **Route handlers return, never throw.** Every `POST` wraps its body in `try` { … } `catch` and returns `NextResponse.json({ success:false, error: … }, { status })`. Status codes in use: `400` (bad input — `app/api/scan/route.ts:361`, `app/api/auth/reset-password/route.ts:41`), `404` (`app/api/profile/[id]/route.ts:19`), `409` (email taken — `app/api/auth/register/route.ts:45`), `413` (too large — `app/api/scan/route.ts:345`), `415` (bad MIME — `app/api/scan/route.ts:334`), `500`, `502` (upstream empty — `app/api/profile/enrich/route.ts:120`).
- **Top-level catch re-throws the message.** `app/api/scan/route.ts:468-471` surfaces `err.message` verbatim to the browser.
- **Optional side effects get their own nested try/catch** so a cache or queue failure cannot fail the primary write — `app/api/scan/route.ts:32` (`preCacheLocation`), `:167` (`pushResearchTask`), `app/api/locations/resolve/route.ts:67` (cache upsert).
- **Outbound integrations degrade to `null`/`false` rather than throwing.** `lib/rabbitmq.ts:11,27,46` returns `null`; `lib/queue/profileCollection.ts:49` returns `false`; `lib/location.ts:459` swallows the Nominatim error; `lib/extractCard.ts:129` converts a `JSON.parse` failure into a descriptive `Error`.
- **Client state machine.** `app/page.tsx:28` `type Status = "idle" | "scanning" | "done" | "error"`; the catch at `:254-257` sets `errorMsg` and `status = "error"`, which renders the retry branch at `:574-600`. Other components hold an independent `error: string | null` (`components/ProfileSlideOver.tsx:95`, `components/ResearchAllButton.tsx:15`).
- **Deliberate cancellation.** `components/ProfileSlideOver.tsx:100,111,140` and `components/ContactMap.tsx` use a `cancelled` flag so in-flight fetches don't `setState` after unmount or after the open dialog closes.
- **Auth errors are opaque by design.** `lib/auth.ts:65-68` catches everything and returns `null`; `app/api/auth/forgot-password/route.ts:27-33` returns a success message for a non-existent email so the endpoint cannot be used to enumerate accounts. That same handler returns the reset link in the JSON body and on stdout (`:54-57, :63`) — a deliberate development affordance with a `TODO` at `:52` to swap in a mail provider.
- **No error boundary.** There is no `app/error.tsx`, no `global-error.tsx`, and no `error.tsx` anywhere. A render-time throw in a client component results in the framework default screen.

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` only — no structured logger, no correlation IDs, no transports. Console output goes to the Docker container's stdout (the deploy job runs `docker compose up -d`, so it lands in `docker logs`). The convention is a bracketed subsystem prefix, applied consistently: `[Scan]` (`app/api/scan/route.ts:164,293,322,466`), `[Map]` (`components/ContactMap.tsx:250,284,317`), `[RabbitMQ]` (`lib/rabbitmq.ts:8,16,21`, `lib/queue/profileCollection.ts:19,30,43,48`), `[Location API]` (`app/api/locations/resolve/route.ts:26,39,65`), `[Location Cache]` (`app/api/locations/cache-check/route.ts:62`), `[ProfileCollection]` (`app/actions/profile-collection.ts:31,66,72,179`), plus loose `AUTH ERROR:` (`lib/auth.ts:66`) and `SCAN ERROR:` (`app/page.tsx:255`). Some `console.log` calls are unconditional debug dumps rather than events — notably `lib/extractCard.ts:126-128` prints the full extracted card on every scan, and `app/actions/profile-collection.ts:66-68` prints the full queue payload.

**Validation:** Hand-rolled and inline, per endpoint, with no schema library. `app/api/scan/route.ts:40-47` hardcodes the MIME allowlist and byte cap; `:255` enforces "rows need name and company"; `app/api/auth/register/route.ts:12-30` checks presence and an 8-char minimum; `app/api/auth/reset-password/route.ts:20` uses a *different* 6-char minimum. Client-side pre-validation is duplicated in the forms (`app/register/page.tsx:46-64`, `app/reset-password/page.tsx:44-57`). There is no zod, valibot, or yup in `package.json`, and no `FormData`/JSON schema shared between client and server.

**Authentication:** NextAuth v4 with a single `CredentialsProvider`, JWT session strategy, no OAuth or database sessions. `bcryptjs` hashes at cost 12 in `app/api/auth/register/route.ts:50` and cost 10 in `app/api/auth/reset-password/route.ts:66`. Role and user id are copied into the JWT (`app/api/auth/[...nextauth]/route.ts:56-61`) and surfaced on the session (`:64-69`), typed via `types/next-auth.d.ts`. Authorisation is three separate mechanisms that do not compose: the edge middleware for page access, inline `role === "DEVELOPER"` checks in the two server actions, and advisory client-side `useSession()` checks that only hide UI. Account lifecycle endpoints (`register`, `forgot-password`, `reset-password`) are hand-written rather than handled by the provider, and `/api/auth/register` hardcodes `role: "USER"` (`:58`), so role assignment is a manual DB edit.

---

*Architecture analysis: 2026-09-29*
