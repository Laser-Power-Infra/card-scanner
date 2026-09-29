---
last_mapped_commit: 6d075c5e67e12a028a845bd113940e927aaa73c4
last_mapped_at: 2026-09-29
---
# Coding Conventions

**Analysis Date:** 2026-09-29

## Naming Patterns

**Files:**

- Components: PascalCase, one component per file, `.tsx` — `components/ContactTable.tsx`, `components/ProfileSlideOver.tsx`
- Pages: lowercase route segment — `app/dashboard/page.tsx`, `app/reset-password/page.tsx`
- Route handlers: always `route.ts` under `app/api/**` — `app/api/scan/route.ts`
- Libraries/modules: camelCase or descriptive lowercase — `lib/extractCard.ts`, `lib/rabbitmq.ts`, `lib/resizeImage.ts`
- Queues grouped in a subfolder — `lib/queue/profileCollection.ts`, `lib/queue/config.ts`
- Scripts: camelCase verb phrase — `scripts/dedupeContacts.ts`
- Types: camelCase file holding a type cluster — `types/card.ts`

**Functions:**

- camelCase verbs — `extractCardFromImage()`, `resolveLocationCoords()`, `preCacheLocation()`, `getCurrentSession()`
- Predicate naming: `isX()` / `hasX()` — `isAdmin()`, `isDeveloper()`, `isOwner()`, `isSpreadsheet()`, `isAuthenticated()`
- Assertion naming: `requireX()` (throws) vs `isX()` (returns boolean) — `lib/permissions.ts:29-70`
- Const-record maps: PascalCase object names, SCREAMING_SNAKE values — `ALLOWED_IMAGE_TYPES`, `FIELD_ALIASES`, `TAG_LABELS`, `STATE_ABBREVIATIONS`
- Private helpers are module-local, not exported — `preCacheLocation()`, `headerToField()`, `cellValue()` in `app/api/scan/route.ts`

**Variables:**

- camelCase locals — `createdContact`, `emailCandidates`, `fieldsToUpdate`
- SCREAMING_SNAKE for module-level constants — `MAX_BYTES`, `CARDS_PER_PAGE`, `EMPTY_CARD`, `QUEUES`, `PROFILE_TAGS`
- Prefix internal iteration vars with `c` for contacts, `m` for mobiles — `lib/location.ts`, `scripts/dedupeContacts.ts`

**Types:**

- `PascalCase`, no `I` prefix — `CardData`, `EnrichedProfile`, `DuplicateEntry`, `ScanResponse`, `ProfileTag`, `LocationInput`
- Props typed as `<ComponentName>Props` — `ContactTableProps`, `RoleGuardProps`, `ProfileCollectionButtonsProps`
- Rule of thumb observed: **`interface` for React props and shared domain types, `type` for literal unions and inline-ish shapes**
  - `interface`: `types/card.ts:1`, `components/RoleGuard.tsx:6`, `components/ContactCard.tsx:15`, `context/AuthProvider.tsx:6`
  - `type`: `app/page.tsx:28` (`Status` union), `components/ContactTable.tsx:6` (`ContactTableProps`), `app/actions/profile-collection.ts:11-21`, `lib/queue/config.ts:14`
  - **Exception — do not copy:** `components/ProfileModal.tsx:7` declares a bare `interface Props`. Always name it `<Component>Props`.

## Code Style

**Formatting:**

- No Prettier config, no `.editorconfig`, no Biome config in the repo.
- Style is hand-maintained and follows the Next.js default template:
  - **Double quotes** for strings and imports — `import { prisma } from "@/lib/prisma";`
  - Semicolons at statement ends
  - 2-space indentation
  - Trailing commas in multi-line literals
  - ~80–100 col soft wrap
- **Inconsistency to avoid adding to:** `app/api/health/route.ts` uses single quotes throughout, and several files have uneven spacing (`app/api/scan/route.ts:444-464` is over-indented; `next.config.ts:9` has no space after commas). Match the dominant double-quote style when editing.

**Linting:**

- `package.json` declares `"lint": "next lint"` but **no ESLint configuration file exists** (`.eslintrc*` / `eslint.config.*` absent) and no `eslint`/`eslint-config-next` dependency is installed. The script will not lint anything as the repo stands.
- `next lint` is deprecated in recent Next.js 15 releases; migration to a standalone ESLint config is the forward path.
- **Practical enforcement today comes from TypeScript, not a linter:** `tsconfig.json` sets `"strict": true`, and `npm run build` / the Docker build (`Dockerfile:36-40`) runs `next build`, which type-checks.
- Therefore: **write code that would pass `strict` TypeScript.** Do not rely on `any` being flagged.

**TypeScript strictness specifics:**

- `strict: true`, `target: ES2017`, `moduleResolution: "bundler"`, `noEmit: true`, `jsx: "preserve"`
- Path alias `"@/*": ["./*"]` — a single alias, resolved from repo root
- `allowJs: true` but only `postcss.config.js` uses JS

## Import Organization

**Order (as practiced):**

1. `"use client"` / `"use server"` directive (line 1, alone, followed by a blank line)
2. Third-party packages — `react`, `next/*`, `next-auth`, `lucide-react`, `openai`, `bcryptjs`, `xlsx`, `amqplib`
3. First-party aliased imports — `@/lib/*`, `@/types/*`, `@/components/*`, `@/context/*`, `@/app/actions/*`
4. Sibling relative imports — `./MultiSelectFilter` (`components/ContactTable.tsx:4`), `./generated/prisma/client` (`lib/prisma.ts:3`)
5. `import type { ... }` declarations are grouped alongside their subject, often after value imports (`app/api/scan/route.ts:4`)

**Path Aliases:**

- **`@/` — cross-directory only.** Use `@/lib/prisma`, never `../../lib/prisma`.
- **Relative `./` — same directory only.** `components/*` importing another component in `components/` uses `./Name`. `lib/prisma.ts` importing the generated client uses `./generated/prisma/client` because the alias `@/lib/generated/...` is deliberately avoided for generated code.
- Node builtins are imported bare, not aliased — `import { randomUUID } from "crypto";` (`app/api/scan/route.ts:2`)

## Error Handling

**Patterns — follow these exactly:**

1. **API route handlers: wrap the entire body in `try`/`catch`, return a JSON error envelope.** Every route in `app/api/**` does this.
   ```ts
   // app/api/profile/[id]/route.ts:24-31
   } catch (error) {
     console.error("Fetch profile error:", error);
     return NextResponse.json(
       { success: false, error: "Failed to fetch profile." },
       { status: 500 }
     );
   }
   ```

2. **Response envelope.** Success: `{ success: true, ...payload }`. Failure: `{ success: false, error: "<message>" }`.
   - **Known inconsistency:** auth routes (`app/api/auth/register/route.ts:16`, `app/api/auth/reset-password/route.ts`) use `message` instead of `error` on failure. **Prefer `error`** for new code and keep `message` alongside it when editing existing auth handlers.

3. **Status codes in use** — map validation failures like this:
   | Situation | Status | Example |
   |---|---|---|
   | Missing / invalid input | `400` | `app/api/scan/route.ts:187` |
   | Unauthenticated | `401` | via `lib/permissions.ts` throws |
   | Forbidden (role) | `403` | `middleware.ts` redirects instead |
   | Resource conflict | `409` | `app/api/auth/register/route.ts:45` |
   | Payload too large | `413` | `app/api/scan/route.ts:341` |
   | Unsupported media type | `415` | `app/api/scan/route.ts:330` |
   | Not found | `404` | `app/api/profile/[id]/route.ts:16` |
   | Unexpected failure | `500` | all catch blocks |

4. **Server actions never throw to the client — return a result object.**
   ```ts
   // app/actions/profile-collection.ts:17-21
   export type PublishProfileCollectionResult = {
     success: boolean;
     queued: boolean;
     error?: string;
   };
   ```
   Every branch returns an object; the outer `catch` converts an unknown throw into `{ success: false, ..., error: err instanceof Error ? err.message : "..." }`.

5. **Safe message extraction on unknown errors.** Use the ternary, never `err.message` blind:
   ```ts
   err instanceof Error ? err.message : "Something went wrong while scanning the card."
   ```
   (`app/api/scan/route.ts:468-471`, `app/actions/profile-collection.ts:88-89`)

6. **Client components: catch into state, don't rethrow.**
   ```ts
   // components/ProfileCollectionButtons.tsx:39-54
   try { ... } catch (err) {
     setQueueError(err instanceof Error ? err.message : "Failed to queue task.");
   } finally { setQueuedTag(null); }
   ```
   Use `try`/`catch`/`finally` together when a loading flag must be cleared — `finally` is used consistently (`app/page.tsx:66-77`).

7. **Library functions throw `Error` for unrecoverable config problems; helpers swallow and log for best-effort work.**
   - Throws: `lib/extractCard.ts:70-72` (`OPENAI_API_KEY is missing...`), `lib/permissions.ts:52,66` (`Unauthorized` / `Forbidden`)
   - Swallows + logs: `preCacheLocation()` (`app/api/scan/route.ts:32-34`), `closeConnection()` (`lib/rabbitmq.ts:59-61`), `lib/location.ts` cache-save failures (`app/api/locations/route.ts:59`)
   - **Rule:** best-effort side work (geocoding cache warm, queue publish) must never fail the request — wrap it and log.

8. **Empty `catch` blocks are acceptable only for cleanup and only with a comment** — `catch { /* ignore cleanup errors */ }` at `lib/rabbitmq.ts:59-61`.

9. **Validation is hand-rolled.** No Zod / Yup / Valibot in the project. Follow the inline guard style:
   ```ts
   // app/api/auth/register/route.ts:11-30
   if (!name || !email || !password) { ... 400 }
   if (password.length < 8) { ... 400 }
   ```
   Bounds constants are module-level named constants — `MAX_BYTES = 8 * 1024 * 1024` (`app/api/scan/route.ts:47`), `ALLOWED_IMAGE_TYPES` (`:40-45`).

## Logging

**Framework:** plain `console.*`. No structured logger, no Sentry, no pino.

**Patterns:**

- **Level mapping:** `console.log` for normal flow events, `console.warn` for rejected/unauthorized attempts, `console.error` for failures.
- **Bracketed subsystem tags** on server-side routes and libs. Use these exact tags when adding logs:
  - `[Scan]` — `app/api/scan/route.ts`
  - `[preCacheLocation]` — `app/api/scan/route.ts:33`
  - `[ProfileCollection]` — `app/actions/profile-collection.ts`
  - `[RabbitMQ]` — `lib/rabbitmq.ts`
  - `[Location API]`, `[Location Cache]` — `app/api/locations/*`
- **Tag placement:** first argument. `console.error("[Scan] Failed to push research task for ${id}:", err)`.
- **Unprefixed style also exists** — `console.error("REGISTER ERROR:", error)`, `console.error("Fetch contacts error:", error)`. Prefer the bracketed form for new code.
- **Untagged debug dumping is present and should not be propagated:** `app/api/auth/forgot-password/route.ts:54-57` prints the password-reset link in banner form, and `lib/extractCard.ts:126-128` dumps extracted PII. Do not add new raw-data dumps.

**Server-only concerns:**

- Route handlers serving Prisma, OpenAI, or `crypto` declare `export const runtime = "nodejs";` and, where relevant, `export const maxDuration = 60;` (`app/api/scan/route.ts:37-38`). Keep these.

## Comments

**When to Comment:**

- Comments explain **why**, not what. Representative examples:
  - `app/page.tsx:82-83` — why the `pageshow` listener checks `e.persisted`
  - `app/api/scan/route.ts:61-62` — documents the spreadsheet header-matching precedence rules
  - `lib/rabbitmq.ts:60` — `// ignore cleanup errors`
  - `app/api/auth/register/route.ts:11` — short section markers (`// Validation`, `// Check existing user`, `// Hash password`)
- **Do not** add comments restating TypeScript that is already self-evident.

**JSDoc/TSDoc:**

- Sparse and used only on non-obvious exported functions:
  - `lib/resizeImage.ts:1-8` — full rationale block for *why* resizing exists
  - `lib/permissions.ts:10-11, 17-18, 26-27, 35-36, 44-47, 58-61, 72-74` — one-line summaries above each helper
  - `app/api/scan/route.ts:61-62` — attached to a module constant
- Inline `//` notes inside function bodies are common (`app/api/scan/route.ts:100`, `:196`, `:223`, `:254`, `:298`, `:426`, `:434`, `:445`, `app/api/scan/route.ts:349`).
- Most exported functions have **no** doc comment. This is acceptable; match it rather than adding boilerplate.

## Function Design

**Size:**

- Handlers are large. `app/api/scan/route.ts` `POST` is ~300 lines and contains both the spreadsheet-import and image-scan paths inline; `components/ContactTable.tsx` is 506 lines; `app/page.tsx` is 534 lines; `components/ContactMap.tsx` is 536 lines.
- Helpers are extracted when the logic is self-contained and reusable (`headerToField()`, `cellValue()`, `normalizeHeader()` at `app/api/scan/route.ts:76-124`). Prefer extracting pure helpers over growing a handler.

**Parameters:**

- API routes use positional `req: NextRequest`; dynamic segments destructure `{ params }: { params: Promise<{ id: string }> }` and `await params` (`app/api/profile/[id]/route.ts:4-9`).
- Optional params via defaults: `maxDimension = 1200`, `quality = 0.85` (`lib/resizeImage.ts:11-12`), `pageSize = 25` (`components/ContactTable.tsx:37`).
- Unused request params are prefixed with `_` — `export async function GET(_req: NextRequest, ...)` (`app/api/profile/[id]/route.ts:5`).
- Server actions take a **single object argument** — `publishProfileCollection(input: PublishProfileCollectionInput)` (`app/actions/profile-collection.ts:23-25`). Follow this for new actions.
- Client components take a single destructured props object; booleans default inline (`compact = false`, `showProfiles = false`).

**Return Values:**

- Named exported result types for anything non-trivial: `ScanResponse` (`types/card.ts:52`), `PublishProfileCollectionResult`, `ResearchAllResult`.
- `null` for "no data" from helpers (`resolveLocationCoords` → `LatLngTuple | null`; `getModel(): Promise<ChannelModel | null>` in `lib/rabbitmq.ts:6`).
- API routes never return bare data — always `NextResponse.json({ success, ... })`.

## Module Design

**Exports:**

- **Components: default export.** `export default function ContactTable(...)`. This is universal across all 19 files in `components/`. Match it.
- **Exception — multi-export component modules:** `components/ProfileRichText.tsx` uses named exports (`Linkify`, `BulletBlock`, `LabelledLinks`, `SourceLinks`, `extractWhatsApp`). It is a utility-collection file, not a single component.
- **Libraries: named exports.** `lib/extractCard.ts` → `export async function extractCardFromImage()`. `lib/permissions.ts` → `export enum Role` plus named helpers.
- **Types: named exports only** — `types/card.ts`, `types/next-auth.d.ts`.
- **Config: named const exports** — `lib/queue/config.ts`, `tailwind.config.ts` (which uses a default export for the config object).
- **Scripts:** no exports; `main()` invoked at module bottom with `.catch().finally()` (`scripts/dedupeContacts.ts:34-41`).

**Barrel Files:**

- **None.** There are no `index.ts` re-export barrels anywhere. Import directly from the owning file (`@/components/ContactCard`, not `@/components`).
- Do not introduce barrels as a refactor.

## Server/Client Boundary

- **`"use client"` on line 1, blank line after** — used in 23 `.tsx` files. It is present on *every* page under `app/` except `app/layout.tsx` (which stays a Server Component to load fonts and metadata), and on every file in `components/` and `context/`.
- **`"use server"`** — `app/actions/profile-collection.ts` only.
- **Client pages import server actions directly** — `import { publishProfileCollection } from "@/app/actions/profile-collection";` (`components/ProfileCollectionButtons.tsx:6`). This is the sanctioned bridge.
- **Browser-only libraries must be dynamically imported with `ssr: false`** — Leaflet in `app/page.tsx:23-26`:
  ```ts
  const ContactMap = dynamic(() => import("@/components/ContactMap"), { ssr: false });
  ```
- **`lib/resizeImage.ts` has no directive** yet uses `document`/`createImageBitmap`; it is only ever imported from client components. Match that: DOM-only helpers live in `lib/` and are consumed from `"use client"` files.

## Styling Approach

- **Tailwind utility classes inline in JSX.** No CSS Modules, no styled-components, no `.module.css` files. All custom CSS is global in `app/globals.css`.
- **Design tokens in `tailwind.config.ts`:**
  - Colors: `graphite`, `graphite2`, `ivory`, `ivorydim`, `copper`, `copperdim`, `ink`
  - Fonts: `display` (Fraunces), `body` (Inter), `mono` (IBM Plex Mono) wired to CSS variables from `next/font/google` in `app/layout.tsx:9-26`
  - Animations: `scanline`, `flipin`
  - **Caveat — token names do not match their values.** `copper` is `#2563EB` (blue), `ivory` is `#10263F` (dark navy), `graphite` is near-white. Read the hex before using a semantic name.
- **Components frequently bypass the tokens** and use raw `slate-*` / `sky-*` / `red-*` / `gray-*` palettes — `components/ProfileCollectionButtons.tsx:67-68`, `components/RoleGuard.tsx:35-36`. **Match the file you are editing**; prefer the configured tokens for new top-level surfaces.
- **Base styling lives on `<body>`** — `app/layout.tsx:42` applies `font-body bg-graphite text-ink antialiased` plus the font variables.
- **`app/globals.css` holds only:** Tailwind directives, `::selection` and `:focus-visible` styling, a global `prefers-reduced-motion` override, and three bespoke classes (`.bg-grain`, `.user-loc-dot`, `.user-loc-circle`).
- Accessibility conventions to preserve: `focus-visible` outline is global; animations are disabled under `prefers-reduced-motion: reduce`; loading states use `animate-pulse` (`components/RoleGuard.tsx:23`).

## Notable Practices

- **Module-level singletons** for connections: `lib/prisma.ts:6-22` caches the client on `globalThis` in non-production; `lib/rabbitmq.ts:3-4` keeps `let model` / `let channel` at module scope and nulls them on `error`/`close` to force reconnect. Follow this shape for any new external client.
- **Environment variables are read inline at point of use**, with a guard, and there is no central config module:
  ```ts
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Add it to .env.local and restart the server.");
  }
  ```
  (`lib/extractCard.ts:69-73`) A `.env` file exists at the repo root; never read or commit its contents — `.gitignore` covers `.env*`.
- **Auth checks are duplicated rather than centralised.** `getServerSession(authOptions)` is called inline in `app/actions/profile-collection.ts:27,108` and `lib/permissions.ts:14`, and role literals (`"DEVELOPER"`, `"ADMIN"`) are compared as raw strings even though `lib/permissions.ts:4-8` exports a `Role` enum. **Use `Role.DEVELOPER` / `Role.ADMIN` for new checks**, or better, reuse `isDeveloper()` / `requireAdmin()`.
- **React state derivation uses `useMemo`, not state+effect.** `components/ContactTable.tsx:45-128` derives dedupe, filter options, and filtered rows in three `useMemo` passes. Prefer this over `useEffect`-driven derived state.
- **Fetch handlers are wrapped in `useCallback`** when passed to effects — `app/page.tsx:66-77`.
- **Effect cleanup** returns the teardown (`app/page.tsx:88-93`).
- **`?.` and `??` for nullish handling throughout**, with defensive defaults on list fields: `data.emails ?? []`, `contact.emails ?? []`.
- **Note:** `README.md` is stale relative to the code (it documents `gpt-4o-mini`, `detail: "low"`, and `ANTHROPIC_API_KEY`; the code uses `gpt-5.6-luna`, `detail: "high"`, and `OPENAI_API_KEY`). Treat the code as the source of truth, and update the README if you touch `lib/extractCard.ts`.

---

*Convention analysis: 2026-09-29*
