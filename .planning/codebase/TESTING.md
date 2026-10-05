# Testing Patterns

**Analysis Date:** 2026-10-03

## Test Framework

**Runner:**
- Vitest 5.0.2
- Config: `vitest.config.ts`
- Environment: `node` (no DOM environment configured)
- Include pattern: `tests/**/*.test.ts`
- Setup file: `tests/setup.ts`

**Assertion Library:**
- Vitest built-in `expect` (Jest-compatible API)

**Run Commands:**
```bash
npm test              # Run all tests (vitest run)
npm run test:watch    # Watch mode (vitest)
npm run typecheck     # Typecheck (prisma generate && next typegen && tsc --noEmit)
npm run lint          # Lint (eslint .)
```

## Test File Organization

**Location:**
- Separate `tests/` directory at repo root (not co-located)
- Organized by concern: `tests/security/`, `tests/ci/`, `tests/helpers/`

**Naming:**
- `*.test.ts` (no `.spec.ts` files)
- Descriptive names: `session-boundary.test.ts`, `cookie-integrity.test.ts`, `gate-commands.test.ts`

**Structure:**
```
tests/
├── setup.ts                      # Global mocks (Prisma, RabbitMQ, OpenAI, next-auth)
├── REQUIREMENT-MAP.md            # Requirement-to-test mapping (data, parsed by coverage test)
├── smoke.test.ts                 # Harness sanity checks
├── ci/
│   ├── deploy-workflow.test.ts   # CI workflow gate assertions
│   └── gate-commands.test.ts     # package.json script gate assertions
├── helpers/
│   ├── jwe.ts                    # JWE cookie fixtures (mint, tamper, decode)
│   └── session.ts                # Session mock helpers (setSession, clearSession)
└── security/
    ├── session-boundary.test.ts      # SEC-01/02/03/07: auth boundary
    ├── route-enumeration.test.ts     # SEC-06: filesystem-discovered route sweep
    ├── role-boundary.test.ts         # SEC-04: role gating (401 vs 403)
    ├── cookie-integrity.test.ts      # SEC-05: JWE crypto verification
    ├── cookie-integrity-live.test.ts # SEC-05: live getServerSession path
    ├── enrichment-visibility.test.ts # SEC-08: anonymous read narrowing
    └── requirements-coverage.test.ts # GATE-02: requirement-to-test mapping
```

## Test Structure

**Suite Organization:**
```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { clearSession, setSession } from "../helpers/session";
import { POST as enrichPOST } from "@/app/api/profile/enrich/route";

afterEach(async () => {
  await clearSession();
  vi.clearAllMocks();
});

describe("SEC-05: the session cookie is verified by real JWE crypto", () => {
  it("returns no session for a tampered cookie", async () => {
    const encoded = await mintValidCookie();
    const tampered = tamperCiphertext(encoded);

    expect(tampered).not.toBe(encoded);
    expect(await decodeSafely(tampered, SECRET)).toBeNull();
  });
});
```

**Patterns:**
- **Setup pattern:** `tests/setup.ts` runs before all tests via `setupFiles` config. It deletes `OPENAI_API_KEY`, `RABBITMQ_URL`, `DATABASE_URL` from `process.env`, sets a fixed `NEXTAUTH_SECRET`, and declares `vi.mock()` for `@/lib/prisma`, `@/lib/rabbitmq`, `@/lib/queue/profileCollection`, `openai`, and `next-auth`.
- **Teardown pattern:** `afterEach` calls `clearSession()` and `vi.clearAllMocks()` to reset auth state and mock call counts between tests.
- **Assertion pattern:** Vitest `expect` with Jest-compatible matchers. Custom failure messages passed as second argument to `expect(actual, message).toEqual(expected)`.
- **Parameterized tests:** `it.each(cases)("$label does X", async ({ ... }) => { ... })` — used extensively in `session-boundary.test.ts` and `route-enumeration.test.ts`.
- **Filesystem-driven tests:** `route-enumeration.test.ts` walks `app/api/**/route.ts` at runtime, imports each module dynamically, and asserts behavior against the discovered set.

## Mocking

**Framework:** Vitest built-in `vi.mock`, `vi.fn`, `vi.mocked`

**Patterns:**

Global mocks in `tests/setup.ts`:
```typescript
// Strip credentials that would allow a live call
delete process.env.OPENAI_API_KEY;
delete process.env.RABBITMQ_URL;
delete process.env.DATABASE_URL;

// Mock Prisma singleton — replaces the entire module
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      // ... every delegate used by any route
    },
    // ... locationCache, user, passwordResetToken
  },
}));

// Mock RabbitMQ
vi.mock("@/lib/rabbitmq", () => ({
  getChannel: vi.fn(async () => null),
  closeConnection: vi.fn(async () => undefined),
}));

// Mock OpenAI — throws on construction so unmocked paths fail at the boundary
vi.mock("openai", () => ({
  default: class {
    constructor() {
      throw new Error("openai must be mocked in tests");
    }
  },
}));

// Mock next-auth — default is "no session"
vi.mock("next-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-auth")>();
  return {
    ...actual,
    getServerSession: vi.fn(async () => null),
  };
});
```

Session control in `tests/helpers/session.ts`:
```typescript
export async function setSession(session: unknown = TEST_SESSION) {
  vi.mocked(getServerSession).mockResolvedValue(session as never);
}

export async function clearSession() {
  vi.mocked(getServerSession).mockResolvedValue(null);
}
```

**What to Mock:**
- `@/lib/prisma` — always (no real DB in tests)
- `@/lib/rabbitmq` — always (no real RabbitMQ in tests)
- `@/lib/queue/profileCollection` — always (depends on RabbitMQ)
- `openai` — always (no real API key; mock throws on construction)
- `next-auth` — always (default: no session; per-test: `setSession()`)
- `next-auth/jwt` — NOT mocked in `cookie-integrity.test.ts` (uses real JWE encode/decode)

**What NOT to Mock:**
- `next-auth/jwt` in cookie-integrity tests — the real crypto is the thing being tested
- Route handlers under test — imported and invoked directly
- `lib/permissions.ts` — imported for `isPublicApiPath` and `PUBLIC_API_PATHS` (production classifier)

## Fixtures and Factories

**Test Data:**

JWE cookie fixtures in `tests/helpers/jwe.ts`:
```typescript
export const MAX_AGE = 60 * 60 * 24 * 30;

export const VALID_CLAIMS = {
  id: "user_test",
  name: "Test User",
  email: "test@example.com",
  role: "ADMIN",
  sub: "user_test",
} satisfies JWT;

export const mintCookie = (token: JWT, secret: string, maxAge = MAX_AGE) =>
  encode({ token, secret, maxAge });

export function tamperCiphertext(token: string): string {
  // Mid-segment substitution — see file for why not last-char
  const segments = token.split(".");
  const ciphertext = segments[3];
  const index = Math.floor(ciphertext.length / 2);
  // ... flip one character
  return segments.join(".");
}

export async function decodeSafely(token: string, secret: string): Promise<JWT | null> {
  const { decode } = await import("next-auth/jwt");
  try {
    return await decode({ token, secret });
  } catch {
    return null;
  }
}
```

Session fixture in `tests/helpers/session.ts`:
```typescript
export const TEST_SESSION = {
  expires: "2999-01-01T00:00:00.000Z",
  user: {
    id: "user_test",
    name: "Test User",
    email: "test@example.com",
    role: "USER",
  },
};
```

**Location:**
- `tests/helpers/` — shared fixtures and helpers
- `tests/REQUIREMENT-MAP.md` — data file mapping requirements to test cases

## Coverage

**Requirements:** None enforced (no coverage threshold configured)

**View Coverage:**
```bash
# No coverage script exists. To add one:
# npm run test -- --coverage
# Requires: npm install -D @vitest/coverage-v8
```

## Test Types

**Unit Tests:**
- Pure function testing is minimal. Most tests are route-handler-level tests that invoke exported HTTP verb functions directly with `NextRequest` objects.
- `lib/permissions.ts` functions (`isPublicApiPath`, `requireApiSession`, `requireApiRole`) are tested indirectly through route handlers and directly in `role-boundary.test.ts`.

**Integration Tests:**
- Route handler tests are the primary integration test form. They import the actual route module, invoke the exported `GET`/`POST` function with a `NextRequest`, and assert on the `Response`.
- `route-enumeration.test.ts` performs a filesystem-discovered sweep: walks `app/api/**/route.ts`, dynamically imports each module, and invokes every exported HTTP verb.
- `enrichment-visibility.test.ts` asserts on the Prisma call arguments (not response body) to verify the `select`/`include` narrowing.

**E2E Tests:**
- Not used. No browser automation framework installed.

**CI/Workflow Tests:**
- `tests/ci/deploy-workflow.test.ts` — parses `.github/workflows/deploy.yml` and asserts gate wiring (verify job runs all three gates, build depends on verify, permissions are explicit).
- `tests/ci/gate-commands.test.ts` — parses `package.json` scripts and `eslint.config.mjs` to verify the lint/test/typecheck gates are real invocations that cannot swallow failures.

## Common Patterns

**Async Testing:**
```typescript
it("returns 401 with the fixed error envelope", async () => {
  const response = await invoke();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
});
```

**Error Testing:**
```typescript
it("returns no session for a tampered cookie", async () => {
  const tampered = tamperCiphertext(encoded);
  expect(await decodeSafely(tampered, SECRET)).toBeNull();
});
```

**Filesystem-Driven Testing:**
```typescript
function routeFilesOnDisk(): string[] {
  const apiDir = resolve(process.cwd(), "app", "api");
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name === "route.ts") {
        found.push(relative(process.cwd(), abs).split(sep).join("/"));
      }
    }
  };
  walk(apiDir);
  return found.sort();
}
```

**Dynamic Module Loading:**
```typescript
const loadRouteModule = (abs: string): Promise<RouteModule> => {
  let pending = moduleCache.get(abs);
  if (!pending) {
    pending = import(abs).then((loaded) => loaded as RouteModule);
    moduleCache.set(abs, pending);
  }
  return pending;
};
```

**Custom Failure Messages:**
```typescript
expect(
  called,
  [
    "The handler answered 401, but Prisma was still touched, so the guard is no",
    "longer ahead of the route's first database call. Each of these ran before",
    "the anonymous caller was refused.",
    "",
    ...called,
  ].join("\n")
).toEqual([]);
```

## Test Infrastructure Details

**`tests/setup.ts`:**
- Runs before every test file via `vitest.config.ts` `setupFiles`
- Deletes `OPENAI_API_KEY`, `RABBITMQ_URL`, `DATABASE_URL` from `process.env`
- Sets `NEXTAUTH_SECRET` to a fixed test value
- Declares `vi.mock()` for all infrastructure modules
- The `openai` mock throws on construction — an unmocked test path fails at the boundary instead of issuing a billable request

**`tests/REQUIREMENT-MAP.md`:**
- Data file mapping requirement IDs to test files and `it(...)` descriptions
- Parsed by `tests/security/requirements-coverage.test.ts` at runtime
- A renamed or deleted test turns the coverage test red (anti-rot mechanism)
- Rows for PWD, ABT, UPL, LOG are deliberately absent (deferred to later phases)

**`tests/helpers/jwe.ts`:**
- `mintCookie()` — creates a real JWE token via `next-auth/jwt.encode`
- `tamperCiphertext()` — deterministically corrupts the ciphertext segment (mid-segment, not last-char, due to A256GCM auth tag bit distribution)
- `decodeSafely()` — wraps `next-auth/jwt.decode` with try/catch, returns `null` on any failure

**`tests/helpers/session.ts`:**
- `setSession(session)` — makes `getServerSession` resolve to the given session
- `clearSession()` — resets to "no session" (the default state every test starts from)

## CI Integration

**Workflow:** `.github/workflows/deploy.yml`

**Verify job** (runs on every push to `main`):
1. `npm ci`
2. `npm run typecheck` — `prisma generate && next typegen && tsc --noEmit`
3. `npm run lint` — `eslint .`
4. `npm test` — `vitest run`

**Build job** (`build-and-push`):
- Depends on `verify` (`needs: verify`)
- Builds Docker image, pushes to GHCR

**Deploy job** (`deploy`):
- Depends on `build-and-push`
- Self-hosted runner, `docker compose pull` / `up -d`

## Gaps and Recommendations

**No component tests:**
- No DOM environment (`jsdom` or `happy-dom`) is configured
- No `@testing-library/react` installed
- Components are not tested in isolation — they are exercised only through manual browser testing
- **Recommendation:** Add `jsdom` environment and `@testing-library/react` for component tests, starting with `ContactTable` (dedupe/filter logic) and `ProfileSlideOver` (polling/cancellation)

**No coverage reporting:**
- No `@vitest/coverage-v8` installed, no coverage script
- **Recommendation:** Add coverage reporting to identify untested branches in `lib/location.ts`, `lib/extractCard.ts`, and `app/api/scan/route.ts`

**No E2E tests:**
- No browser automation (Playwright/Cypress)
- Critical user flows (upload → scan → enrich → view) are only verified manually
- **Recommendation:** Add Playwright for critical path E2E tests

**Untested areas:**
- `lib/location.ts` — pure functions (`deriveStateCountry`, `resolveLocationCoords`) with high branching, no tests
- `lib/extractCard.ts` — LLM response parsing, fenced-JSON extraction, no tests
- `lib/resizeImage.ts` — browser-dependent, no tests
- `middleware.ts` — route gating logic, no tests
- `app/actions/profile-collection.ts` — DEVELOPER role gate, no tests
- All component render paths

**Test environment limitation:**
- Tests run in `node` environment only — no DOM, no browser APIs
- Route handler tests work because they invoke exported functions directly, not through Next.js runtime
- `cookie-integrity-live.test.ts` tests the real `getServerSession` path but cannot invoke the NextAuth catch-all outside a live request scope (structural fallback used instead)

---

*Testing analysis: 2026-10-03*
