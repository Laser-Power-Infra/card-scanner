---
last_mapped_commit: 6d075c5e67e12a028a845bd113940e927aaa73c4
last_mapped_at: 2026-09-29
---
# Testing Patterns

**Analysis Date:** 2026-09-29

## Test Framework

**There is no test framework in this repository. No automated tests exist.**

This was verified directly against the repo, not inferred:

- `package.json` `scripts` contains only `dev`, `build`, `start`, `lint`. **There is no `test` script.**
- `package.json` `devDependencies` contains no test tooling — no `jest`, `vitest`, `@playwright/test`, `cypress`, `@testing-library/react`, `@testing-library/jest-dom`, `msw`, `supertest`, or any coverage provider.
- No `jest.config.*`, `vitest.config.*`, `playwright.config.*`, or `cypress.config.*` file exists anywhere in the repo.
- A repo-wide glob for `**/*.{test,spec}.{ts,tsx,js,jsx}` returned **zero files**.
- No `__tests__/` directory, no `*.test.*`, no `*.spec.*`, no fixtures or factory files.
- No coverage config, no coverage thresholds, no coverage artifact directory.

**Consequence:** there are no test patterns to follow, no existing suite to imitate, and no coverage baseline. Any new test infrastructure is greenfield and you own its conventions.

## Test File Organization

**Current state:** N/A — no test files exist.

**Where new tests should go** (once a runner is added):

- Co-locate unit tests beside the module: `lib/location.test.ts` next to `lib/location.ts`, `components/ContactTable.test.tsx` next to `components/ContactTable.tsx`. This repo is small and flat, so co-location keeps the test next to the only thing it tests.
- Pure-function and route-handler tests are the highest-value and cheapest to add first (see "Recommended Test Targets" below).

## Current CI

`.github/workflows/deploy.yml` is the only workflow. It runs on push to `main` and has two jobs:

1. **`build-and-push`** (`ubuntu-latest`) — checkout, Docker Buildx, login to GHCR, build `./Dockerfile`, push tagged `latest` and `<short_sha>`, with `type=gha` build cache.
2. **`deploy`** (`self-hosted`, PowerShell) — `docker compose pull` / `up -d`, prune old images.

**The workflow has no lint step, no type-check step, and no test step.** The only automated gate is the `npm run build` executed inside `Dockerfile:36-40`, which runs `next build` and therefore performs a `tsc` type-check under `strict: true`. That catches type errors only — not runtime behavior, not logic regressions, not broken auth flows.

Note also that `"lint": "next lint"` in `package.json` is not wired into CI, and no ESLint config file exists in the repo, so that script currently lints nothing even if invoked.

## Run Commands

**Not applicable — there is nothing to run.**

The commands that *would* exist once a runner is added, for reference:

```bash

# (would be) run all tests

npm test

# (would be) watch mode during development

npm run test:watch

# (would be) coverage report

npm run test:coverage
```

None of these scripts exist today. Do not assume a failing `npm test` means broken code — it means the script is missing.

## Mocks and Fixtures

**None exist.** There is no mocking library, no mock service layer, and no test doubles.

Notably, the codebase is also not structured for testability:

- `lib/prisma.ts` exports a **module-level singleton** bound to a real Postgres connection, imported directly by every route handler.
- `lib/rabbitmq.ts` keeps connection state in **module-level `let` variables** with reconnect listeners.
- `lib/extractCard.ts` constructs the OpenAI client inline inside the function (`new OpenAI(...)`) — good, it's injectable-by-env, but there's no seam for injecting a fake.
- Client components call `fetch()` inline with hardcoded `"/api/..."` paths (`app/page.tsx:69`).

The main testing obstacle is the absence of dependency-injection seams. See "What Would Need to Change" below.

## Test Types

- **Unit tests:** none exist.
- **Integration tests:** none exist.
- **E2E tests:** none exist.
- **Manual/verification testing:** what the team actually relies on today. The app is exercised by hand in the browser (`npm run dev`, port 4000) against a live Postgres and RabbitMQ.

## Recommended Test Targets

Because there is no safety net, these are the areas where a bug is both likely and expensive. Ordered by value-per-effort:

1. **Pure functions in `lib/location.ts` (449 lines)** — `deriveStateCountry()`, state-abbreviation lookup, city-to-state mapping. Deterministic, no I/O, high branching. The cheapest meaningful tests in the repo.
2. **Spreadsheet header mapping in `app/api/scan/route.ts:63-124`** — `normalizeHeader()`, `mapHeader()`, `headerToField()`. Pure, and the alias precedence rules are subtle enough to regress silently. Currently the file is 425 lines with zero coverage of this parsing logic.
3. **Duplicate detection / merge in `app/api/scan/route.ts:272-464`** — the `orClauses` OR-matching, the "new info only" merge, and the `duplicate_skipped` / `merged` branch. This is business-critical and subtle.
4. **Auth routes** — `app/api/auth/register/route.ts`, `app/api/auth/reset-password/route.ts`, `lib/permissions.ts` (role checks, `requireAuth`/`requireAdmin` throwing).
5. **`lib/resizeImage.ts`** — early-return conditions for non-image and small files; browser-dependent so it needs a DOM environment.
6. **`components/ContactTable.tsx` dedupe + filter logic** — the `makeKey()` dedupe and cascaded filters are pure and testable as extracted functions, but currently embedded in component body.

## Test Coverage Gaps

Essentially total. Untested and high-risk:

- `app/api/scan/route.ts` — image and spreadsheet ingestion, duplicate merge, 400/413/415 error branches. The most important endpoint in the app.
- `lib/extractCard.ts` — LLM response parsing, the `extractJson()` fenced-block/unfenced-JSON fallback, and every `?? null` / `Array.isArray` default.
- `lib/permissions.ts` and all auth routes — no tests that a non-DEVELOPER is actually rejected.
- `middleware.ts` route-gating logic — the `matcher` array and the `/admin` role redirect are load-bearing security behavior with no test.
- `app/actions/profile-collection.ts` — the DEVELOPER-role gate and the queue-failure path.
- `lib/rabbitmq.ts` — connection failure / reconnect behavior.
- All 19 components and all 8 pages render paths.

## What Would Need to Be Added

This is a greenfield setup. The minimum viable starting point:

**1. Pick a runner.** Vitest is the natural fit for this repo: it runs on Vite (already Next's toolchain via Turbidopack/SWC), understands TypeScript and path aliases with near-zero config, and gives you unit + component testing in one dependency. Jest with `next/jest` is the alternative and is more prescriptive with Next.js.

**2. Install the runner and its DOM environment.** Add to `devDependencies`: `vitest`, `jsdom` (or `happy-dom`), `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@vitest/coverage-v8`. These are all currently absent.

**3. Add the config file** (`vitest.config.ts` at repo root, alongside `tailwind.config.ts` / `next.config.ts`). Two things it must resolve to make the existing code testable:

   - The `@/*` alias, so imports like `@/lib/prisma` resolve — mirror `tsconfig.json` `paths`.
   - The Prisma generated client at `@/lib/generated/prisma/client`, which is gitignored (`.gitignore:9`) and won't exist until `npx prisma generate` runs. The test setup must either run generate or stub the module.

**4. Wire `environment: 'jsdom'`** for component tests — `ContactTable`, `RoleGuard`, `UploadZone` and friends touch `window`, `document`, and Leaflet.

**5. Establish the seams that don't currently exist.** Without these, tests either hit real infrastructure or can't isolate logic:

   - Mock `@/lib/prisma` in route tests (the module exports a live singleton, so `vi.mock` is the pragmatic option).
   - Mock `@/lib/rabbitmq` / `@/lib/queue/profileCollection` for the action and scan tests.
   - Set `process.env.OPENAI_API_KEY` (and stub the OpenAI client) so `lib/extractCard.ts` takes the branch you want rather than throwing.
   - For UI: either add `msw` to intercept the `/api/*` calls components make, or accept that component tests focus on pure/render behavior and leave data-fetching to integration tests.

**6. Add the scripts** to `package.json`: `test`, `test:watch`, `test:coverage`.

**7. Wire `npm run test` into CI.** The build-and-deploy workflow (`.github/workflows/deploy.yml`) currently has no test step. The natural first addition is a job before `build-and-push` that runs `npm ci && npx prisma generate && npm test`, so a failing suite blocks the Docker push and the deploy.

---

*Testing analysis: 2026-09-29*
