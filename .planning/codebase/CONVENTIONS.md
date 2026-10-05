# Coding Conventions

**Analysis Date:** 2026-10-03

## Naming Patterns

**Files:**
- Components: PascalCase, one component per file, `.tsx` — `components/ContactTable.tsx`, `components/ProfileSlideOver.tsx`, `components/UploadZone.tsx`
- Pages: lowercase route segment — `app/dashboard/page.tsx`, `app/reset-password/page.tsx`, `app/force-reset/page.tsx`
- Route handlers: always `route.ts` under `app/api/**` — `app/api/scan/route.ts`, `app/api/contacts/batch/route.ts`
- Libraries/modules: camelCase or descriptive lowercase — `lib/extractCard.ts`, `lib/rabbitmq.ts`, `lib/resizeImage.ts`, `lib/validation.ts`, `lib/contact.ts`, `lib/draftStorage.ts`, `lib/httpsCheck.ts`, `lib/rateLimit.ts`, `lib/scriptAudit.ts`
- Queues grouped in a subfolder — `lib/queue/profileCollection.ts`, `lib/queue/config.ts`
- Scripts: camelCase verb phrase — `scripts/dedupeContacts.ts`, `scripts/backfill-location.ts`, `scripts/clean-name-job-company.ts`, `scripts/phone-fields.ts`, `scripts/post-migration-checks.ts`
- Types: camelCase file holding a type cluster — `types/card.ts`, `types/next-auth.d.ts`, `types/css.d.ts`
- Test files: `*.test.ts` under `tests/` — `tests/smoke.test.ts`, `tests/security/session-boundary.test.ts`

**Functions:**
- camelCase verbs — `extractCardFromImage()`, `resolveLocationCoords()`, `preCacheLocation()`, `getCurrentSession()`, `validateContact()`, `downloadVCard()`
- Predicate naming: `isX()` / `hasX()` — `isAdmin()`, `isDeveloper()`, `isOwner()`, `isSpreadsheet()`, `isAuthenticated()`, `isPublicApiPath()`
- Assertion naming: `requireX()` (returns `NextResponse | null` for route guards) vs `isX()` (returns boolean) — `lib/permissions.ts:215-251`
- Guard naming: `requireApiSession()` / `requireApiRole()` — the two load-bearing auth guards, both return `null` (proceed) or a `NextResponse` (deny)
- Const-record maps: PascalCase object names, SCREAMING_SNAKE values — `ALLOWED_IMAGE_TYPES`, `FIELD_ALIASES`, `TAG_LABELS`, `STATE_ABBREVIATIONS`, `PUBLIC_API_PATHS`
- Private helpers are module-local, not exported — `preCacheLocation()`, `headerToField()`, `cellValue()`, `normalizeHeader()` in `app/api/scan/route.ts`

**Variables:**
- camelCase locals — `createdContact`, `emailCandidates`, `fieldsToUpdate`, `deduped`, `filteredContacts`
- SCREAMING_SNAKE for module-level constants — `MAX_BYTES`, `CARDS_PER_PAGE`, `EMPTY_CARD`, `QUEUES`, `PROFILE_TAGS`, `ENRICHMENT_ONLY_FIELDS`
- Prefix internal iteration vars with `c` for contacts, `m` for mobiles — `lib/location.ts`, `scripts/dedupeContacts.ts`

**Types:**
- `PascalCase`, no `I` prefix — `CardData`, `EnrichedProfile`, `DuplicateEntry`, `ScanResponse`, `ProfileTag`, `LocationInput`, `ContactsPage`
- Props typed as `<ComponentName>Props` — `ContactTableProps`, `RoleGuardProps`, `ProfileCollectionButtonsProps`, `FilterState`
- Rule of thumb observed: **`interface` for React props and shared domain types, `type` for literal unions and inline-ish shapes**

## Code Style

**Formatting:**
- No Prettier config, no `.editorconfig`, no Biome config in the repo.
- Style is hand-maintained and follows the Next.js default template:
  - Double quotes for strings (dominant style)
  - Semicolons at statement end
  - 2-space indentation
  - Trailing commas in multi-line structures
- **Inconsistency to avoid adding to:** `app/api/health/route.ts` uses single quotes throughout, and several files have uneven spacing. Match the dominant double-quote style when editing.

**Linting:**
- **ESLint 10** with flat config (`eslint.config.mjs`) — NOT `next lint`
- Uses `typescript-eslint` recommended rules + `@next/eslint-plugin-next` + `eslint-plugin-react-hooks`
- Key rules:
  - `@typescript-eslint/no-explicit-any`: **warn** (not error — debt stays visible)
  - `@typescript-eslint/no-require-imports`: **warn** (scripts use `require("fs")`)
  - `@typescript-eslint/no-unused-vars`: **error** with `ignoreRestSiblings: true`
  - `react-hooks/exhaustive-deps`: **error**
  - `@next/next/no-img-element`: **error**
  - `reportUnusedDisableDirectives: "error"` — a stale disable directive fails the gate
- `eslint-config-next` is deliberately NOT installed (circular-structure TypeError with `eslint-plugin-react-hooks` at Next 15.5.26)

**TypeScript:**
- `strict: true`, `target: ES2017`, `moduleResolution: "bundler"`, `noEmit: true`, `jsx: "preserve"`
- Path alias `"@/*": ["./*"]` — a single alias, resolved from repo root
- `allowJs: true` but only `postcss.config.js` uses JS
- `isolatedModules: true`, `resolveJsonModule: true`, `esModuleInterop: true`

## Import Organization

**Order:**
1. Node builtins (bare) — `import { randomUUID } from "crypto"`, `import { readFileSync, readdirSync } from "node:fs"`
2. External packages — `import { NextRequest, NextResponse } from "next/server"`, `import { getServerSession } from "next-auth"`
3. `@/` alias imports (cross-directory) — `import { prisma } from "@/lib/prisma"`, `import { extractCardFromImage } from "@/lib/extractCard"`
4. Relative `./` imports (same directory) — `import MultiSelectFilter from "./MultiSelectFilter"`, `import { prisma } from "../lib/prisma"` (scripts)
5. Type-only imports — `import type { CardData, ScanResponse } from "@/types/card"`

**Path Aliases:**
- `"@/*": ["./*"]` — single alias, resolved from repo root
- `@/` is for cross-directory only; same-directory imports use relative `./`
- Node builtins are imported bare, not aliased
- Generated Prisma client imported as `./generated/prisma/client` (relative, not aliased)

## Error Handling

**Patterns:**
- **Route handlers return, never throw.** Every `POST` wraps its body in `try { … } catch` and returns `NextResponse.json({ success:false, error: … }, { status })`.
- **Auth guards return `NextResponse | null`.** `requireApiSession()` and `requireApiRole()` return `null` (proceed) or a `NextResponse` (deny). Handlers use: `const denied = await requireApiSession(); if (denied) return denied;`
- **Status codes in use:** `400` (bad input), `401` (unauthenticated), `403` (forbidden), `404`, `409` (conflict), `413` (too large), `415` (bad MIME), `500`, `502` (upstream empty)
- **Optional side effects get their own nested try/catch** so a cache or queue failure cannot fail the primary write — `app/api/scan/route.ts:32` (`preCacheLocation`), `:167` (`pushResearchTask`)
- **Outbound integrations degrade to `null`/`false` rather than throwing.** `lib/rabbitmq.ts` returns `null`; `lib/queue/profileCollection.ts` returns `false`; `lib/location.ts` swallows the Nominatim error
- **Auth errors are opaque by design.** `lib/auth.ts:68-71` catches everything and returns `null`; `app/api/auth/forgot-password/route.ts` returns a success message for a non-existent email (anti-enumeration)
- **Client state machine.** `app/page.tsx` uses `type Status = "idle" | "scanning" | "done" | "error"`; catch sets `errorMsg` and `status = "error"`
- **Deliberate cancellation.** `components/ProfileSlideOver.tsx` and `components/ContactMap.tsx` use a `cancelled` flag so in-flight fetches don't `setState` after unmount

## Logging

**Framework:** `console` (no logging library)

**Level mapping:**
- `console.log` — normal flow events (connection status, run start)
- `console.warn` — rejected/unauthorized attempts (`[Auth] Rejected unauthenticated API request`)
- `console.error` — failures (`[RabbitMQ] Connection error:`, `[preCacheLocation] Error:`)

**Patterns:**
- **Bracketed subsystem tags** on server-side routes and libs. Use these exact tags when adding logs:
  - `[Auth]` — `lib/permissions.ts:194,242`
  - `[RabbitMQ]` — `lib/rabbitmq.ts:8,16,21,27,41,45,50`
  - `[preCacheLocation]` — `app/api/scan/route.ts:33`
  - `[Scan]` — `app/api/scan/route.ts`
  - `[ProfileCollection]` — `lib/queue/profileCollection.ts`
- **Tag placement:** first argument. `console.error("[RabbitMQ] Failed to push research task:", err)`
- **Unprefixed style also exists** — `console.error("AUTH ERROR:", error)` in `lib/auth.ts:69`. Prefer the bracketed form for new code.
- **No raw-data dumps.** `lib/extractCard.ts` dumps extracted PII at `:126-128` — do not add new raw-data dumps.

## Comments

**When to Comment:**
- Comments explain **why**, not what. Representative examples:
  - `lib/permissions.ts:12-52` — extensive doc comment on `PUBLIC_API_PATHS` explaining the exact-equality decision and the two kinds of public routes
  - `lib/permissions.ts:172-184` — explains why `resolveApiSession()` exists (single session read, 401-before-403 ordering)
  - `tests/helpers/jwe.ts:28-42` — explains why mid-segment substitution is used for tampering (A256GCM auth tag bits)
  - `eslint.config.mjs:5-24` — explains why `eslint-config-next` is not installed
- **Do not** add comments restating TypeScript that is self-evident.
- Inline `//` notes inside function bodies are common for non-obvious decisions.
- Most exported functions have **no** doc comment. This is acceptable; match it rather than adding boilerplate.

**JSDoc/TSDoc:**
- Sparse. Used on non-obvious exported functions in `lib/` (`requireApiSession`, `requireApiRole`, `isPublicApiPath`, `getCurrentSession`)
- Test files use block comments to explain the *purpose* of a test case, not just what it does

## Function Design

**Size:**
- Handlers are large. `app/api/scan/route.ts` `POST` is ~300 lines; `components/ContactTable.tsx` is 500+ lines; `app/page.tsx` is 500+ lines.
- Helpers are extracted when the logic is self-contained and reusable (`headerToField()`, `cellValue()`, `normalizeHeader()` at `app/api/scan/route.ts:76-124`). Prefer extracting pure helpers over growing a handler.

**Parameters:**
- API routes use positional `req: NextRequest`; dynamic segments destructure `{ params }: { params: Promise<{ id: string }> }` and `await params`
- Optional params via defaults: `maxDimension = 1200`, `quality = 0.85` (`lib/resizeImage.ts`), `pageSize = 25` (`components/ContactTable.tsx`)
- Unused request params are prefixed with `_` — `export async function GET(_req: NextRequest, ...)`
- Server actions take a **single object argument** — `publishProfileCollection(input: PublishProfileCollectionInput)`
- Client components take a single destructured props object; booleans default inline (`compact = false`, `showProfiles = false`)

**Return Values:**
- `null` for "no data" from helpers (`resolveLocationCoords` → `LatLngTuple | null`; `getModel(): Promise<ChannelModel | null>`)
- API routes never return bare data — always `NextResponse.json({ success, ... })`
- Auth guards return `NextResponse | null` (not throw)
- Named exported result types for anything non-trivial: `ScanResponse`, `PublishProfileCollectionResult`, `ResearchAllResult`

## Module Design

**Exports:**
- **Components: default export.** `export default function ContactTable(...)`. Universal across all files in `components/`. Match it.
- **Exception — multi-export component modules:** `components/ProfileRichText.tsx` uses named exports (`Linkify`, `BulletBlock`, `LabelledLinks`, `SourceLinks`, `extractWhatsApp`). It is a utility-collection file, not a single component.
- **Libraries: named exports.** `lib/extractCard.ts` → `export async function extractCardFromImage()`. `lib/permissions.ts` → `export enum Role` plus named helpers.
- **Types: named exports only** — `types/card.ts`, `types/next-auth.d.ts`.
- **Config: named const exports** — `lib/queue/config.ts`, `tailwind.config.ts` (default export for the config object).
- **Scripts:** no exports; `main()` invoked at module bottom with `.catch().finally()` (`scripts/dedupeContacts.ts:40-47`). Scripts use `ScriptAudit` from `lib/scriptAudit.ts` for run logging.
- **No barrels.** There are no `index.ts` re-export barrels anywhere. Import directly from the owning file.

## Server/Client Boundary

- **`"use client"` on line 1, blank line after** — used in `.tsx` files. Present on every page under `app/` except `app/layout.tsx` (Server Component for fonts/metadata), and on every file in `components/` and `context/`.
- **`"use server"`** — `app/actions/profile-collection.ts` only.
- **Client pages import server actions directly** — `import { publishProfileCollection } from "@/app/actions/profile-collection"`
- **Browser-only libraries must be dynamically imported with `ssr: false`** — Leaflet in `app/page.tsx:26-29`: `const ContactMap = dynamic(() => import("@/components/ContactMap"), { ssr: false })`
- **`lib/resizeImage.ts` has no directive** yet uses `document`/`createImageBitmap`; it is only ever imported from client components. DOM-only helpers live in `lib/` and are consumed from `"use client"` files.
- **`lib/contact.ts` has browser-only functions** (`downloadVCard` uses `URL.createObjectURL`, `document.createElement`) — consumed only from client components.

## Styling Approach

- **Tailwind utility classes inline in JSX.** No CSS Modules, no styled-components, no `.module.css` files. All custom CSS is global in `app/globals.css`.
- **Design tokens in `tailwind.config.ts`:** custom palette (`graphite`, `ivory`, `copper`, `ink`), font families bound to CSS variables, keyframes (`scanline`, `flipin`). Content globs cover `app/**` and `components/**`.
- **Components frequently bypass the tokens** and use raw `slate-*` / `sky-*` / `red-*` / `gray-*` palettes. **Match the file you are editing**; prefer the configured tokens for new top-level surfaces.
- **Base styling lives on `<body>`** — `app/layout.tsx` applies `font-body bg-graphite text-ink antialiased` plus the font variables.
- **`app/globals.css` holds only:** Tailwind directives, `::selection` and `:focus-visible` styling, a global `prefers-reduced-motion` override, and three bespoke classes (`.bg-grain`, `.user-loc-dot`, `.user-loc-circle`).
- Accessibility conventions to preserve: `focus-visible` outline is global; animations are disabled under `prefers-reduced-motion: reduce`; loading states use `animate-pulse`.

## Notable Practices

- **Module-level singletons** for connections: `lib/prisma.ts:6-22` caches the client on `globalThis` in non-production; `lib/rabbitmq.ts:3-4` keeps `let model` / `let channel` at module scope and nulls them on `error`/`close` to force reconnect. Follow this shape for any new external client.
- **Environment variables are read inline at point of use**, with a guard, and there is no central config module. `dotenv` is a declared dependency (^18.0.4) and is imported by `prisma.config.ts` and scripts via `import "dotenv/config"`.
- **Auth guards are centralized in `lib/permissions.ts`.** `requireApiSession()` and `requireApiRole()` are the two load-bearing guards. `PUBLIC_API_PATHS` is the public-by-decision allowlist used by tests, NOT a runtime gate. The `Role` enum is exported from `lib/permissions.ts` and should be used instead of raw string literals.
- **React state derivation uses `useMemo`, not state+effect.** `components/ContactTable.tsx` derives dedupe, filter options, and filtered rows in `useMemo` passes. Prefer this over `useEffect`-driven derived state.
- **Fetch handlers are wrapped in `useCallback`** when passed to effects — `app/page.tsx:74-77`.
- **Effect cleanup** returns the teardown (`app/page.tsx:88-93`).
- **`?.` and `??` for nullish handling throughout**, with defensive defaults on list fields: `data.emails ?? []`, `contact.emails ?? []`.
- **Scripts use `ScriptAudit`** from `lib/scriptAudit.ts` for structured run logging and `.hjson` run reports in `scripts/runs/`.
- **Test infrastructure uses `vi.mock` at the setup level** (`tests/setup.ts`) to replace Prisma, RabbitMQ, OpenAI, and next-auth with offline fakes. Individual tests use `setSession()` / `clearSession()` from `tests/helpers/session.ts` to control auth state.

---

*Convention analysis: 2026-10-03*
