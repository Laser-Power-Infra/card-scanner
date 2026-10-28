# Codebase Structure

**Analysis Date:** 2026-10-03

## Directory Layout

```
card-scanner/
├── app/                    # Next.js App Router — pages, API routes, server actions
│   ├── actions/            # Server actions ("use server")
│   │   └── profile-collection.ts
│   ├── api/                # Route handlers
│   │   ├── auth/           # Auth routes (NextAuth, register, reset, etc.)
│   │   ├── contacts/       # Contact CRUD (list, update, batch)
│   │   ├── health/         # Liveness probe
│   │   ├── locations/      # Geocoding endpoints (4 routes)
│   │   ├── profile/        # Profile read + enrichment
│   │   └── scan/           # Card scan + spreadsheet import
│   ├── contacts/[id]/      # Single contact profile page
│   ├── dashboard/          # Dashboard page
│   ├── force-reset/        # Forced password reset page
│   ├── forgot-password/    # Forgot password page
│   ├── login/              # Login page
│   ├── register/           # Registration page
│   ├── reset-password/     # Reset password page
│   ├── globals.css         # Global styles (Tailwind + custom)
│   ├── layout.tsx          # Root layout (fonts, AuthProvider, Navbar)
│   └── page.tsx            # Home page (SPA shell)
├── components/             # React components (13 files)
│   ├── ContactCard.tsx
│   ├── ContactMap.tsx
│   ├── ContactTable.tsx
│   ├── DirectoryToolbar.tsx
│   ├── MultiSelectFilter.tsx
│   ├── Navbar.tsx
│   ├── ProfileCollectionButtons.tsx
│   ├── ProfileRichText.tsx
│   ├── ProfileSlideOver.tsx
│   ├── ResearchAllButton.tsx
│   ├── ScannerStage.tsx
│   ├── SearchBar.tsx
│   └── UploadZone.tsx
├── context/                # React context providers
│   └── AuthProvider.tsx
├── lib/                    # Shared library modules
│   ├── queue/              # Queue config + publisher
│   │   ├── config.ts
│   │   └── profileCollection.ts
│   ├── generated/prisma/   # Generated Prisma client (gitignored)
│   ├── auth.ts             # NextAuth options
│   ├── contact.ts          # vCard, initials, URL helpers
│   ├── draftStorage.ts     # localStorage edit drafts
│   ├── extractCard.ts      # OpenAI vision card extraction
│   ├── httpsCheck.ts       # HTTPS enforcement helper
│   ├── location.ts         # Geocoding + state/country derivation
│   ├── permissions.ts      # Role enum, auth gates, PUBLIC_API_PATHS
│   ├── prisma.ts           # PrismaClient singleton
│   ├── rabbitmq.ts         # RabbitMQ connection singleton
│   ├── rateLimit.ts        # In-memory rate limiter
│   ├── resizeImage.ts      # Client-side image downscale
│   ├── scriptAudit.ts      # Script audit trail
│   └── validation.ts       # Contact field validation
├── prisma/                 # Prisma schema + migrations
│   ├── migrations/         # 10 migration files
│   └── schema.prisma
├── scripts/                # CLI scripts
│   ├── dedupeContacts.ts
│   └── runs/               # Script output (gitignored)
├── tests/                  # Test suite (Vitest)
│   ├── ci/                 # CI gate tests
│   ├── helpers/            # Test helpers (session, jwe)
│   ├── security/           # Security boundary tests
│   ├── setup.ts            # Test setup (mocks)
│   └── smoke.test.ts
├── types/                  # Shared TypeScript types
│   ├── card.ts
│   └── next-auth.d.ts
├── .github/workflows/      # CI/CD
│   └── deploy.yml
├── .planning/              # GSD planning artifacts (gitignored)
├── public/                 # Static assets (empty except .gitkeep)
├── data/                   # Data directory (empty)
├── Dockerfile              # 3-stage Docker build
├── docker-compose.yml      # Container orchestration
├── middleware.ts           # Edge middleware (auth gate)
├── next.config.ts          # Next.js config
├── package.json            # Dependencies + scripts
├── postcss.config.js       # PostCSS config
├── prisma.config.ts        # Prisma 7 config
├── tailwind.config.ts      # Tailwind config
├── tsconfig.json           # TypeScript config
├── eslint.config.mjs       # ESLint config
└── vitest.config.ts        # Vitest config
```

## Directory Purposes

**`app/`:**
- Purpose: Next.js App Router — all pages, API routes, and server actions
- Contains: Route handlers (`route.ts`), pages (`page.tsx`), server actions (`"use client"` / `"use server"`)
- Key files: `app/page.tsx` (SPA shell), `app/api/scan/route.ts` (card ingest), `app/actions/profile-collection.ts` (queue publisher)

**`app/api/`:**
- Purpose: HTTP route handlers organized by domain
- Contains: `auth/`, `contacts/`, `health/`, `locations/`, `profile/`, `scan/`
- Key files: `app/api/scan/route.ts` (487 lines, image + spreadsheet ingest), `app/api/contacts/route.ts` (cursor-based list)

**`components/`:**
- Purpose: React components, all client-side (`"use client"`)
- Contains: 13 `.tsx` files — cards, table, map, slide-over, toolbar, upload zone, etc.
- Key files: `components/ContactMap.tsx` (536 lines, Leaflet map), `components/ContactTable.tsx` (506 lines, 8-axis filtering), `components/ProfileSlideOver.tsx` (enrichment polling)

**`context/`:**
- Purpose: React context providers
- Contains: `AuthProvider.tsx` (SessionProvider wrapper)
- Key files: `context/AuthProvider.tsx`

**`lib/`:**
- Purpose: Shared library modules — business logic, external clients, pure functions
- Contains: 14 `.ts` files + `queue/` subdirectory + `generated/prisma/` (gitignored)
- Key files: `lib/extractCard.ts` (OpenAI vision), `lib/location.ts` (488 lines, geocoding), `lib/permissions.ts` (251 lines, auth gates), `lib/prisma.ts` (PrismaClient singleton)

**`lib/queue/`:**
- Purpose: RabbitMQ queue configuration and publisher
- Contains: `config.ts` (queue name + tag union), `profileCollection.ts` (publish helper)
- Key files: `lib/queue/profileCollection.ts`

**`prisma/`:**
- Purpose: Database schema and migrations
- Contains: `schema.prisma` (5 models, 2 enums), `migrations/` (10 files)
- Key files: `prisma/schema.prisma`

**`scripts/`:**
- Purpose: CLI scripts run via `tsx`
- Contains: `dedupeContacts.ts` (read-only duplicate report), `runs/` (output, gitignored)
- Key files: `scripts/dedupeContacts.ts`

**`tests/`:**
- Purpose: Vitest test suite
- Contains: `setup.ts` (mocks), `smoke.test.ts`, `ci/` (gate tests), `security/` (boundary tests), `helpers/`
- Key files: `tests/setup.ts` (module mocks), `tests/security/route-enumeration.test.ts` (filesystem-derived route audit)

**`types/`:**
- Purpose: Shared TypeScript type definitions
- Contains: `card.ts` (CardData, EnrichedProfile, ScanResponse), `next-auth.d.ts` (session augmentation)
- Key files: `types/card.ts`

**`.github/workflows/`:**
- Purpose: CI/CD pipeline
- Contains: `deploy.yml` (verify → build → push → deploy)
- Key files: `.github/workflows/deploy.yml`

## Key File Locations

**Entry Points:**
- `middleware.ts`: Edge middleware — auth gate for all routes
- `app/layout.tsx`: Root layout — fonts, AuthProvider, Navbar
- `app/page.tsx`: Home page — SPA shell with upload, list, 3 view modes
- `app/actions/profile-collection.ts`: Server actions — DEVELOPER-gated queue publishing

**Configuration:**
- `package.json`: Dependencies + scripts (`dev`, `build`, `start`, `test`, `typecheck`, `lint`)
- `next.config.ts`: Next.js config (10mb body limit, allowedDevOrigins, eslint ignoreDuringBuilds)
- `tsconfig.json`: TypeScript config (strict, ES2017, bundler resolution, `@/*` alias)
- `tailwind.config.ts`: Tailwind config (custom palette, fonts, keyframes)
- `eslint.config.mjs`: ESLint config (typescript-eslint, next plugin, react-hooks)
- `vitest.config.ts`: Vitest config (node environment, `@/` alias)
- `prisma.config.ts`: Prisma 7 config (schema path, migrations, datasource URL)
- `postcss.config.js`: PostCSS config (tailwindcss, autoprefixer)
- `Dockerfile`: 3-stage Docker build (pnpm install --frozen-lockfile → prisma generate + build → standalone)
- `docker-compose.yml`: Container orchestration (GHCR image, port 4111, .env.production)

**Core Logic:**
- `app/api/scan/route.ts`: Card scan + spreadsheet import (487 lines)
- `lib/extractCard.ts`: OpenAI vision card extraction
- `lib/location.ts`: Geocoding + state/country derivation (488 lines)
- `lib/permissions.ts`: Auth gates + PUBLIC_API_PATHS (251 lines)
- `app/actions/profile-collection.ts`: Queue publishing (199 lines)
- `lib/queue/profileCollection.ts`: RabbitMQ publisher

**Testing:**
- `tests/setup.ts`: Test setup — mocks for prisma, rabbitmq, openai, next-auth
- `tests/security/route-enumeration.test.ts`: Filesystem-derived route audit
- `tests/security/role-boundary.test.ts`: Role boundary tests
- `tests/security/session-boundary.test.ts`: Session boundary tests
- `tests/security/cookie-integrity.test.ts`: Cookie integrity tests
- `tests/security/enrichment-visibility.test.ts`: Enrichment visibility tests
- `tests/security/requirements-coverage.test.ts`: Requirements coverage tests
- `tests/ci/deploy-workflow.test.ts`: Deploy workflow tests
- `tests/ci/gate-commands.test.ts`: Gate command tests
- `tests/smoke.test.ts`: Smoke tests

## Naming Conventions

**Files:**
- Components: PascalCase, one component per file, `.tsx` — `ContactTable.tsx`, `ProfileSlideOver.tsx`
- Pages: lowercase route segment — `app/dashboard/page.tsx`, `app/reset-password/page.tsx`
- Route handlers: always `route.ts` under `app/api/**` — `app/api/scan/route.ts`
- Libraries/modules: camelCase or descriptive lowercase — `lib/extractCard.ts`, `lib/rabbitmq.ts`, `lib/resizeImage.ts`
- Queues grouped in a subfolder — `lib/queue/profileCollection.ts`, `lib/queue/config.ts`
- Scripts: camelCase verb phrase — `scripts/dedupeContacts.ts`
- Types: camelCase file holding a type cluster — `types/card.ts`
- Test files: `*.test.ts` — `tests/security/route-enumeration.test.ts`

**Directories:**
- `app/api/{domain}/route.ts` — API route handlers by domain
- `app/{page-name}/page.tsx` — Page routes
- `components/` — Flat, no subdirectories (except none)
- `lib/` — Flat with `queue/` subdirectory for queue-related modules
- `tests/{category}/` — Tests organized by category (security, ci, helpers)

## Where to Add New Code

**New API Route:**
- Implementation: `app/api/{domain}/route.ts`
- Export `GET`/`POST`/`PATCH` functions
- Add `export const runtime = "nodejs"` if using Node-only modules
- Add `export const maxDuration = 60` for long-running operations
- Use `requireApiSession()` from `lib/permissions.ts` for auth gating
- Return `NextResponse.json({ success: true/false, ... })`

**New Page:**
- Implementation: `app/{page-name}/page.tsx`
- Add `"use client"` on line 1 if interactive
- Use `useSession()` from `next-auth/react` for auth state
- Fetch data via `fetch("/api/...")` in `useEffect`

**New Component:**
- Implementation: `components/{ComponentName}.tsx`
- Add `"use client"` on line 1
- Default export: `export default function ComponentName({ ... }: ComponentNameProps)`
- Props interface: `interface ComponentNameProps { ... }`
- Use Tailwind utility classes for styling

**New Library Module:**
- Implementation: `lib/{moduleName}.ts`
- Named exports only: `export async function functionName() { ... }`
- No default exports
- Use `@/` alias for cross-directory imports

**New Server Action:**
- Implementation: `app/actions/{action-name}.ts`
- Add `"use server"` on line 1
- Export async functions with typed input/output
- Use `getServerSession(authOptions)` for auth checks

**New Test:**
- Implementation: `tests/{category}/{test-name}.test.ts`
- Use `describe`/`it`/`expect` from vitest
- Mock external services in `tests/setup.ts`
- Use `tests/helpers/session.ts` for session mocking

**New Script:**
- Implementation: `scripts/{script-name}.ts`
- Run via `pnpm tsx scripts/{script-name}.ts`
- Use `import "dotenv/config"` at top
- Use `lib/scriptAudit.ts` for audit trail

**New Type:**
- Implementation: `types/{domain}.ts`
- Named exports only: `export interface TypeName { ... }`
- Use `interface` for React props and shared domain types
- Use `type` for literal unions and inline shapes

## Special Directories

**`lib/generated/prisma/`:**
- Purpose: Generated Prisma client code
- Generated: Yes — run `pnpm prisma generate` after schema changes
- Committed: No — gitignored (`.gitignore:9`)

**`.planning/`:**
- Purpose: GSD planning artifacts (phases, codebase maps, research)
- Generated: Yes — by GSD commands
- Committed: No — gitignored (`.gitignore:10`)

**`scripts/runs/`:**
- Purpose: Script output files
- Generated: Yes — by script execution
- Committed: No — gitignored (`.gitignore:13`)

**`data/`:**
- Purpose: Data directory (currently empty)
- Generated: No
- Committed: Yes (but empty)

**`public/`:**
- Purpose: Static assets served at `/`
- Generated: No
- Committed: Yes — currently only `.gitkeep`

---

*Structure analysis: 2026-10-03*
