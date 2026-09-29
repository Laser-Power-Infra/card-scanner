---
last_mapped_commit: 6d075c5e67e12a028a845bd113940e927aaa73c4
last_mapped_at: 2026-09-29
---
# Codebase Structure

**Analysis Date:** 2026-09-29

## Directory Layout

```
card-scanner/
├── app/                          # App Router root — pages, route handlers, server actions
│   ├── page.tsx                  # Home SPA: scan + directory + map (616 lines)
│   ├── layout.tsx                # Root layout — the only server component
│   ├── globals.css               # Tailwind layers + .bg-grain, .user-loc-dot
│   ├── actions/
│   │   └── profile-collection.ts # "use server" — DEVELOPER-gated RabbitMQ publishes
│   ├── admin/page.tsx            # Admin shell (hardcoded zeros)
│   ├── dashboard/page.tsx        # Dashboard shell (hardcoded zeros)
│   ├── directory/page.tsx        # Directory shell over hardcoded sampleContacts
│   ├── login/page.tsx            # Credentials sign-in (inline form)
│   ├── register/page.tsx         # Registration (inline form)
│   ├── forgot-password/page.tsx
│   ├── reset-password/page.tsx   # Reads ?token= via useParams
│   ├── reset-password/token      # Stray empty file — no extension, not a route
│   └── api/                      # All HTTP endpoints (Backend-for-Frontend)
│       ├── auth/
│       │   ├── [...nextauth]/route.ts   # NextAuth handler + inline authOptions
│       │   ├── register/route.ts
│       │   ├── forgot-password/route.ts
│       │   └── reset-password/route.ts
│       ├── contacts/route.ts     # GET all contacts + enrichment
│       ├── health/route.ts       # GET liveness
│       ├── locations/
│       │   ├── route.ts          # POST single geocode [UNCALLED]
│       │   ├── batch/route.ts    # POST batch geocode  [UNCALLED]
│       │   ├── cache-check/route.ts  # POST bulk DB cache probe
│       │   └── resolve/route.ts  # POST single resolve-and-cache
│       ├── profile/
│       │   ├── [id]/route.ts     # GET one contact + enrichment (poll target)
│       │   └── enrich/route.ts   # POST synchronous LLM research
│       └── scan/route.ts         # POST image vision + spreadsheet import (425 lines)
├── components/                   # Presentational + interactive client components (18 files)
├── context/
│   └── AuthProvider.tsx          # next-auth SessionProvider wrapper
├── lib/
│   ├── auth.ts                   # NextAuth options (duplicate of [...nextauth] copy)
│   ├── extractCard.ts            # OpenAI vision prompt + JSON coercion
│   ├── location.ts               # Curated geo tables + Nominatim fallback
│   ├── permissions.ts            # requireAuth/requireAdmin/… [UNUSED]
│   ├── prisma.ts                 # Global-cached PrismaClient + PrismaPg adapter
│   ├── rabbitmq.ts               # Module-level AMQP connection/channel singleton
│   ├── resizeImage.ts            # Client-side canvas downscale before upload
│   ├── generated/prisma/         # GENERATED Prisma client — gitignored
│   └── queue/
│       ├── config.ts             # QUEUES + PROFILE_TAGS + ProfileTag type
│       └── profileCollection.ts  # publishProfileCollectionTask()
├── prisma/
│   ├── schema.prisma             # 5 models, 2 enums; client output → lib/generated/prisma
│   └── migrations/               # 7 timestamped migrations
├── scripts/
│   └── dedupeContacts.ts         # Standalone read-only duplicate report
├── types/
│   ├── card.ts                   # CardData, EnrichedProfile, DuplicateEntry, ScanResponse
│   ├── next-auth.d.ts            # Session/User/JWT augmentation (id, role)
│   └── css.d.ts
├── public/                       # Empty (.gitkeep) — no uploaded files are persisted
├── .github/workflows/deploy.yml  # build → GHCR push → self-hosted compose deploy
├── middleware.ts                 # Edge auth gate (root, NOT inside app/)
├── next.config.ts                # standalone output, 10mb serverActions limit
├── prisma.config.ts              # Prisma CLI config (schema/migrations/DATABASE_URL)
├── tailwind.config.ts            # Design tokens + scanline/flipin keyframes
├── tsconfig.json                 # strict, "@/*" → "./*"
├── Dockerfile                    # 3-stage → node server.js on :4111
├── docker-compose.yml            # Pulls ghcr.io image onto external `infra` network
├── postcss.config.js
└── .env                          # Local env (gitignored — never read or commit)
```

## Directory Purposes

**`app/`:**

- Purpose: Everything the App Router owns — pages, route handlers, server actions, global CSS.
- Contains: `layout.tsx`, `page.tsx`, `globals.css`, one directory per route, `api/**/route.ts`, `actions/*.ts`.
- Key files: `app/layout.tsx` (the only server component), `app/page.tsx` (616-line home SPA), `app/api/scan/route.ts` (425-line ingest endpoint), `app/actions/profile-collection.ts` (the only `"use server"` file).
- Convention: route segments are lowercase and single-word (`admin`, `login`, `dashboard`, `directory`, `register`, `forgot-password`, `reset-password`) or kebab-case where multi-word (`forgot-password`, `reset-password`, `cache-check`). Dynamic segments use `[id]`; the NextAuth catch-all uses `[...nextauth]`. Every directory contains exactly one `page.tsx` or one `route.ts` — never both.

**`app/api/`:**

- Purpose: The entire server API. There is no separate backend service.
- Contains: `route.ts` files exporting `GET`/`POST`, one level of nesting at most.
- Key files: `app/api/scan/route.ts` (image + spreadsheet ingest, dedupe, merge, pre-cache, queue publish), `app/api/locations/resolve/route.ts` (cache-then-resolve), `app/api/locations/cache-check/route.ts` (bulk probe the map calls first), `app/api/contacts/route.ts` (the one list endpoint).
- Convention: folder name = URL segment; the file inside is always literally `route.ts`. No `api/v1` versioning prefix — URLs are `/api/scan`, `/api/contacts`, `/api/profile/[id]`, `/api/locations/resolve`.

**`components/`:**

- Purpose: Reusable React components. No subdirectories, no barrel `index.ts` — each file is imported directly.
- Contains: 18 `.tsx` files, all default-exported components.
- Key files: `ContactMap.tsx` (536 lines, Leaflet + two-phase geocoding), `ContactTable.tsx` (506 lines, dedupe + 8-axis filters), `ProfileSlideOver.tsx` (366 lines, 5s polling), `UploadZone.tsx` (drag-drop/camera/spreadsheet), `ProfileRichText.tsx` (named exports, not a component), `Navbar.tsx` (global chrome), `ProtectedRoute.tsx` / `RoleGuard.tsx` ([UNUSED]).
- Convention: `PascalCase.tsx`, `export default function Name()`. Props are declared either as `interface XProps` (ContactCard, UploadZone, ProfileSlideOver, RoleGuard, ProtectedRoute, ProfileCollectionButtons, ScannerStage, LoginForm, RegisterForm, MultiSelectFilter) or as `type XProps` (ContactTable, DirectoryToolbar, SearchBar) — both forms are in use.

**`context/`:**

- Purpose: React context providers. Currently exactly one.
- Contains: `AuthProvider.tsx` — a 20-line `"use client"` wrapper that configures `SessionProvider` (`refetchInterval: 5*60`, `refetchOnWindowFocus: true`). It adds no context of its own.
- Convention: `PascalCase.tsx`, default export, `children: ReactNode` prop.

**`lib/`:**

- Purpose: Server-capable shared logic plus the two client-safe pure helpers.
- Contains: `auth.ts`, `prisma.ts`, `rabbitmq.ts`, `permissions.ts`, `extractCard.ts`, `location.ts`, `resizeImage.ts`, and the `queue/` subdirectory. Plus the generated `generated/prisma/` client.
- Key files: `lib/extractCard.ts` (the scan prompt + OpenAI call), `lib/location.ts` (449 lines of geo lookup tables — the largest pure module), `lib/rabbitmq.ts` (the only place `amqplib` is imported), `lib/prisma.ts` (the only place `PrismaClient` is constructed).
- Convention: `camelCase.ts` for flat modules (`extractCard.ts`, `resizeImage.ts`, `rabbitmq.ts`, `permissions.ts`), plain lowercase for the single-word ones (`auth.ts`, `location.ts`, `prisma.ts`). Subsystems that grow get a subdirectory with a `camelCase.ts` file inside (`lib/queue/profileCollection.ts`).
- Server/client boundary is **not** expressed by directory. `lib/location.ts` and `lib/resizeImage.ts` are imported by `"use client"` code (`app/page.tsx:19`, `:18`); `lib/extractCard.ts`, `lib/rabbitmq.ts`, `lib/prisma.ts` and `lib/auth.ts` are server-only in practice, enforced only by never importing them from a client module.

**`lib/queue/`:**

- Purpose: Everything RabbitMQ. The consumer does not live in this repo.
- Contains: `config.ts` (queue name, tag vocabulary, derived `ProfileTag` type), `profileCollection.ts` (the `ProfileCollectionTaskPayload` envelope and the publisher).
- Convention: one file per message family. The only `amqplib` import in the whole codebase is `lib/rabbitmq.ts:1`; every publish goes through `lib/queue/*`.

**`prisma/`:**

- Purpose: Schema and migrations.
- Contains: `schema.prisma`, `migrations/<14-digit-timestamp>_<snake_case_description>/`.
- Key files: `prisma/schema.prisma` — `Contact` (`:15`), `Role` enum (`:40`), `User` (`:46`), `EnrichmentStatus` enum (`:64`), `Enrichment` (`:72`), `PasswordResetToken` (`:105`), `LocationCache` (`:117`). Generator output is redirected to `../lib/generated/prisma` (`:8`) and the datasource uses no `url` — it is injected by the driver adapter at runtime.
- Migration list (7): `20260707072552_adding_contact_model`, `20260708062018_add_password_reset`, `20260708112504_add_user_table`, `20260807115056_add_enrichment`, `20260810104417_add_developer_role`, `20260810123516_added_cascade`, `20260916101208_add_locationcache`.
- Convention: model and field names are PascalCase/camelCase; only `Enrichment` is mapped to a snake_case table via `@@map("enrichment")` and its fields use snake_case directly. Everything else relies on Prisma's default mapping.

**`scripts/`:**

- Purpose: One-off operational scripts run outside the Next.js build.
- Contains: `dedupeContacts.ts`.
- Convention: `camelCase.ts`, an async `main()` with `.catch`/`.finally` and `prisma.$disconnect()` (`:34-41`). Not wired into any npm script.

**`types/`:**

- Purpose: Shared TypeScript interfaces and module augmentations.
- Contains: `card.ts` (the app's DTOs), `next-auth.d.ts` (module augmentation), `css.d.ts`.
- Convention: `camelCase.ts`; declaration files use the standard `*.d.ts` suffix. All types here are consumed via `import type { … } from "@/types/…"` with no runtime import.

**`public/`:**

- Purpose: Static assets. Currently empty — only `.gitkeep`.
- Key fact: uploaded card images are never written to disk; they are base64-encoded in memory at `app/api/scan/route.ts:352` and discarded after the OpenAI call.

## Key File Locations

**Entry Points:**

- `middleware.ts`: Edge auth gate. Runs on every request matching the matcher at `:57-63`.
- `app/layout.tsx`: Root layout. The only server component in the repo; wraps everything in `AuthProvider` → `Navbar` → `{children}`.
- `app/page.tsx`: Home SPA. The real product surface — scan, list, map, export.
- `app/api/scan/route.ts`: `GET` health probe, `POST` image/spreadsheet ingest.
- `app/api/contacts/route.ts`: `GET` the full contact list.
- `app/api/profile/[id]/route.ts`: `GET` one contact + enrichment (the poll target).
- `app/api/profile/enrich/route.ts`: `POST` LLM research.
- `app/api/locations/cache-check/route.ts`, `app/api/locations/resolve/route.ts`: `POST` geocode (the two the map actually calls).
- `app/api/auth/[...nextauth]/route.ts`: NextAuth `GET`/`POST`.
- `app/api/auth/register/route.ts`, `app/api/auth/forgot-password/route.ts`, `app/api/auth/reset-password/route.ts`: account flows.
- `app/api/health/route.ts`: liveness probe, CORS-open.
- `app/actions/profile-collection.ts`: the only `"use server"` module; exports `publishProfileCollection` and `researchAllContacts`.
- `scripts/dedupeContacts.ts`: standalone maintenance entry point.
- `.github/workflows/deploy.yml`: CI entry point on push to `main`.

**Configuration:**

- `next.config.ts`: `output: "standalone"`, 10 MB `serverActions.bodySizeLimit`, `allowedDevOrigins` for two LAN IPs.
- `tsconfig.json`: `strict: true`, `moduleResolution: "bundler"`, and the sole path alias `"@/*": ["./*"]`.
- `tailwind.config.ts`: content globs cover only `app/**` and `components/**`; custom colors (`graphite`, `ivory`, `copper`, `ink`), font families bound to CSS variables, and the `scanline` / `flipin` animations.
- `postcss.config.js`: Tailwind/PostCSS wiring.
- `prisma.config.ts`: Prisma 7 CLI config — schema path, migrations path, `DATABASE_URL` from env.
- `docker-compose.yml`: pulls `ghcr.io/laser-power-infra/card_scanner:${APP_VERSION:-latest}`, port `4111:4111`, joins the external `infra` network, reads `.env.production`.
- `Dockerfile`: three stages (deps → build with `npx prisma generate` → runtime), `EXPOSE 4111`, `CMD ["node","server.js"]`.
- `.env`: present and gitignored. Never read, never quote.

**Core Logic:**

- `lib/extractCard.ts`: the scan system prompt (`:5-45`), fenced-JSON unwrapper (`:47`), OpenAI vision call (`:64`), and per-field coercion (`:135`).
- `lib/location.ts`: `INDIAN_STATES` (`:1`), `STATE_ABBREVIATIONS` (`:37`), `CITY_TO_STATE` (`:59`), `COUNTRIES` (`:133`), `INTERNATIONAL_CITY_TO_COUNTRY` (`:157`), `CITY_COORDS` (`:337`), `deriveStateCountry` (`:290`), `geocodeFallback` (`:435`), `resolveLocationCoords` (`:464`).
- `lib/rabbitmq.ts`: `getModel` (`:6`), `getChannel` (`:32`), `closeConnection` (`:55`).
- `lib/queue/config.ts`: `QUEUES.PROFILE_COLLECTION = "CS-profile:collection"` (`:2`), `PROFILE_TAGS` (`:5`).
- `lib/queue/profileCollection.ts`: `ProfileCollectionTaskPayload` (`:5`), `publishToQueue` (`:13`), `publishProfileCollectionTask` (`:53`).
- `lib/auth.ts`: NextAuth credentials provider and JWT/session callbacks.
- `lib/prisma.ts`: the `globalThis` client cache and `PrismaPg` adapter.
- `lib/resizeImage.ts`: client-side canvas downscale to 1200px / JPEG 0.85.
- `app/api/scan/route.ts`: `FIELD_ALIASES` (`:63`), `headerToField` (`:84`), `preCacheLocation` (`:10`), `pushResearchTask` (`:126`).

**Testing:**

- None. There is no test directory, no test file, no test runner in `package.json`, and no coverage configuration anywhere in the repo.

**Dead / Unreferenced Code:**

- `lib/permissions.ts` — no importer.
- `components/ProtectedRoute.tsx` — no importer.
- `components/RoleGuard.tsx` — no importer.
- `components/ProfileModal.tsx` — no importer (its only consumer of `/api/profile/enrich` was removed; `ProfileSlideOver` is used instead).
- `components/LoginForm.tsx`, `components/RegisterForm.tsx` — no importer; `app/login/page.tsx` and `app/register/page.tsx` each inline their own form. `RegisterForm.tsx:65` still calls `/api/auth/register`.
- `app/api/locations/route.ts`, `app/api/locations/batch/route.ts` — no caller.
- `app/directory/page.tsx` — reachable only by direct URL; the navbar links are commented out at `components/Navbar.tsx:35-47`.
- `app/reset-password/token` — a zero-byte file with no extension, shadowing nothing; the reset page reads the token from the URL path/query, not from disk.
- `README.md` `Project structure` block (`:55-72`) — describes a three-file project that no longer matches the tree.

## Naming Conventions

**Files:**

- `camelCase.ts` for logic modules: `extractCard.ts`, `resizeImage.ts`, `rabbitmq.ts`, `profileCollection.ts`, `dedupeContacts.ts`.
- Single lowercase words for one-concern modules: `auth.ts`, `location.ts`, `prisma.ts`, `permissions.ts`, `config.ts`.
- `PascalCase.tsx` for every component: `ContactMap.tsx`, `ProfileSlideOver.tsx`, `ProfileCollectionButtons.tsx`, `ProtectedRoute.tsx`, `RoleGuard.tsx`, `AuthProvider.tsx`.
- All-lowercase `page.tsx`, `layout.tsx`, `route.ts`, `globals.css` — these are framework-mandated names, never renamed.
- `kebab-case` for multi-word route segments: `forgot-password`, `reset-password`, `cache-check`.
- `<thing>.config.ts` for tooling config: `next.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `prisma.config.ts`.
- `<lib>.d.ts` for declaration files: `next-auth.d.ts`, `css.d.ts`.
- `YYYYMMDDHHMMSS_snake_case` for Prisma migrations.
- No barrel files and no `index.ts` anywhere — every import names the concrete file.

**Directories:**

- Route segments: lowercase, kebab-case if multi-word (`app/forgot-password/`, `app/api/locations/cache-check/`).
- Dynamic segments in square brackets: `app/api/profile/[id]/`, `app/api/auth/[...nextauth]/`.
- Semantic source dirs are flat lowercase nouns: `components/`, `context/`, `lib/`, `prisma/`, `scripts/`, `types/`, `public/`.
- Mixed plural: `components/`, `scripts/`, `types/` are plural; `context/`, `lib/`, `prisma/`, `public/` are singular.

**Types:**

- Interfaces in PascalCase with no `I` prefix: `CardData`, `EnrichedProfile`, `DuplicateEntry`, `ScanResponse`, `ContactMapProps`, `UploadZoneProps`.
- Inline `type X = …` for unions and prop bags: `Status`, `Point`, `FilterState`, `LocationInput`, `PublishProfileCollectionInput`, `ResearchAllMode`, `ContactTableProps`.
- Prisma models are PascalCase and map to default PascalCase tables; only `Enrichment` is `@@map`'d to snake_case.
- DB field names are camelCase except inside `Enrichment`, which uses snake_case columns (`linkedin_url`, `career_background`, `enriched_at`). Client components mirror that split — `ProfileSlideOver.tsx:42-57` types `enrichment` with snake_case keys.
- Type-only imports always use `import type { … } from "@/types/…"`.

**Constants:**

- `SCREAMING_SNAKE_CASE` for module constants: `ALLOWED_IMAGE_TYPES`, `MAX_BYTES`, `FIELD_ALIASES`, `SYSTEM_PROMPT`, `QUEUES`, `PROFILE_TAGS`, `INDIAN_STATES`, `CITY_TO_STATE`, `CITY_COORDS`, `GEOCODE_CACHE`, `SESSION_CACHE`, `INDIA_CENTER`, `STATUS_STYLES`, `TAG_LABELS`, `CARDS_PER_PAGE`, `STATUS_STYLES`, `ESRI_ATTRIBUTION`, `LINK_CLASS`.
- DB enum values are `SCREAMING_SNAKE_CASE`: `USER`, `ADMIN`, `DEVELOPER`, `PENDING`, `RUNNING`, `DONE`, `PARTIAL`, `FAILED`.
- `Status` union in `app/page.tsx:28` is lowercase (`"idle" | "scanning" | "done" | "error"`).

**Functions:**

- `camelCase`, arrow or `function` declaration used interchangeably. Exported helpers use named `export function` (`resolveLocationCoords`, `deriveStateCountry`, `extractCardFromImage`, `requireAuth`); local helpers use module-private `function` (`normalizeHeader`, `cellValue`, `safeString`, `initials`, `buildVCard` inline).
- Route handlers are always `export async function GET|POST`.
- Guard/helper naming prefixes: `is*` (`isAdmin`, `isAuthenticated`, `isOwner`, `isSpreadsheet`), `require*` (`requireAuth`, `requireAdmin`), `derive*` (`deriveStateCountry`), `resolve*` (`resolveLocationCoords`), `publish*` (`publishProfileCollectionTask`), `pre*` (`preCacheLocation`), `normalize*` (`normalizeHeader`, `normalizeUrl`, `normalizeCountry`, `normalizeProfile`, `normalizeSocialProfiles`), `match*` (`matchCity`, `matchKnownState`, `matchKnownCountry`, `matchStateAbbreviation`, `matchInternationalCity`, `matchCityCoords`), `get*` (`getChannel`, `getModel`, `getCurrentSession`).

**CSS:**

- Tailwind utility classes in JSX, with semantic tokens from `tailwind.config.ts`: `font-display`, `font-body`, `font-mono`, `bg-graphite`, `text-ink`, `bg-grain`, `animate-scanline`.
- Two design dialects coexist: the home page and its components use the semantic tokens, while `app/dashboard/page.tsx`, `app/directory/page.tsx`, `app/admin/page.tsx` and the auth pages use raw Tailwind palette (`bg-slate-100`, `text-sky-600`, `bg-white rounded-xl shadow`). Match the file you are editing rather than normalising.
- Global custom classes in `app/globals.css`: `.bg-grain`, `.user-loc-dot`, `.user-loc-circle`, `@keyframes user-loc-pulse`.

## Where to Add New Code

**New API endpoint (route handler):**

- Create `app/api/<segment>/route.ts` (or `app/api/<segment>/<sub>/route.ts` for one level of nesting). Export `GET`/`POST` returning `NextResponse.json(...)`.
- Import `prisma` from `@/lib/prisma`; import DTOs from `@/types/*`.
- Add an auth guard at the top of the handler — `getServerSession(authOptions)` from `@/lib/auth` — rather than relying on `middleware.ts`, whose matcher does not cover `/api/*`.
- If the endpoint belongs to an existing subsystem, prefer extending the existing file (`app/api/locations/resolve/route.ts`) over adding a fifth location route.
- Add the path to the `matcher` in `middleware.ts:57-63` only if it should be page-gated.

**New page:**

- Create `app/<segment>/page.tsx`. Start it with `"use client"` and `useState`/`useEffect` + `fetch()` — this matches every existing page. Do not introduce an async server component without also establishing the RSC data pattern for the whole app.
- Add the segment to `middleware.ts:57-63` if it must be authenticated.
- Add the nav entry in `components/Navbar.tsx` (both the desktop block at `:31-60` and the mobile block at `:153-215` — they are duplicated).
- Include the new directory in `tailwind.config.ts:4-7` if you place a component outside `app/` or `components/` — the content globs cover only those two.

**New server action:**

- Create `app/actions/<feature>.ts` with `"use server"` on line 1.
- Gate on role with `getServerSession(authOptions)` at the top, returning a typed result object rather than throwing — mirror `app/actions/profile-collection.ts:23-92`.
- Import it from a `"use client"` component and `await` it directly (`components/ResearchAllButton.tsx:27`).

**New component:**

- Create `components/PascalCase.tsx` with a default export.
- If it is browser-only or pulls in a heavy dependency (Leaflet, `xlsx`), load it with `next/dynamic` at the call site with `{ ssr: false }` — see `app/page.tsx:23-26`.
- Declare props with an explicit `interface XProps`; make callbacks props (`onClose`, `onViewProfile`, `onFileSelected`) rather than reaching for a global store, which does not exist in this codebase.
- Import it with the `@/components/...` alias.

**New shared type:**

- Add to `types/card.ts` if it is a contact/domain DTO; otherwise create `types/<name>.ts` and import it as `import type { … } from "@/types/<name>"`.
- Keep server and client shapes in sync by editing this file, not by redeclaring the shape in a component — `components/ProfileSlideOver.tsx:28-60` is the one place that currently does this, and it is a maintenance hazard.

**New external integration:**

- Wrap the client in `lib/<integration>.ts` exporting a getter with a module-level singleton and null-on-failure semantics, exactly like `lib/rabbitmq.ts`.
- Put message/queue vocabulary in `lib/queue/config.ts` as a const array plus a derived type, and the publisher in `lib/queue/<feature>.ts`.
- For LLM calls, add `lib/<task>.ts` holding the prompt as a module constant and the response coercion as a pure function (pattern: `lib/extractCard.ts`).

**New database model or field:**

- Edit `prisma/schema.prisma`, then create a migration. Migration folders are `prisma/migrations/YYYYMMDDHHMMSS_snake_case_name/`.
- If the app consumes the new field, regenerate the client — output goes to `lib/generated/prisma` (`prisma/schema.prisma:8`), which is gitignored, so never edit files there by hand.
- Remember the model is exposed to the browser through `types/card.ts` and the route handler that returns it; widen the DTO or the client's inline type at the same time.

**New location/geo logic:**

- Extend the lookup tables in `lib/location.ts` rather than adding a new resolution path — `CITY_TO_STATE` and `CITY_COORDS` are kept as parallel tables and must be updated together.
- Do not add another endpoint under `app/api/locations/`; extend `resolve/route.ts` and have `cache-check` reuse the same body.

**New maintenance script:**

- `scripts/camelCase.ts` with an async `main()` plus `.catch`/`.finally` + `prisma.$disconnect()`, matching `scripts/dedupeContacts.ts:34-41`. Keep it read-only by default and print the plan for the operator to execute, as `dedupeContacts.ts:4` and `:31` do.

## Special Directories

**`lib/generated/prisma/`:**

- Purpose: The Prisma 7 generated client (13 files: `client.ts`, `browser.ts`, `models.ts`, `enums.ts`, `commonInputTypes.ts`, plus `internal/` and `models/` subfolders).
- Generated: Yes — by `npx prisma generate`, also run explicitly in `Dockerfile:34`.
- Committed: No — `/lib/generated/prisma` is in `.gitignore:9`. Regenerate locally; never hand-edit.
- Import from `@/lib/prisma` (which re-exports the configured singleton), not from the generated path directly. The one exception is `lib/prisma.ts:3` itself, which imports `./generated/prisma/client`.

**`prisma/migrations/`:**

- Purpose: Ordered SQL migrations, 7 of them.
- Generated: Yes — by `prisma migrate dev`; `prisma.config.ts:9` points the CLI at this path.
- Committed: Yes.
- Convention: `YYYYMMDDHHMMSS_snake_case_description`; the newest, `20260916101208_add_locationcache`, matches the newest feature work in `lib/location.ts`.

**`public/`:**

- Purpose: Static assets served at the site root.
- Generated: No.
- Committed: Yes — but it contains only `.gitkeep`. No user-uploaded file is ever written here; images are processed in memory and discarded.

**`.next/`:**

- Purpose: Next.js build output. `output: "standalone"` (`next.config.ts:10`) makes `Dockerfile:64` copy `.next/standalone` as the runtime root.
- Generated: Yes.
- Committed: No — `.gitignore:2`. Also contains `tsconfig.tsbuildinfo` at the repo root (incremental TS cache, also untracked in practice).

**`node_modules/`:**

- Generated by `npm ci`; `Dockerfile:13-18` installs in a cached stage and copies only `node_modules` + `prisma` forward.
- Committed: No — `.gitignore:1`.

**`.planning/`:**

- Purpose: GSD planning artifacts, including this `codebase/` directory.
- Committed: Repository-specific — confirm with the orchestrator before adding to git.
- Not part of the application build; `tsconfig.json:21` includes `**/*.ts`, so any `.ts` files placed here are type-checked.

---

*Structure analysis: 2026-09-29*
