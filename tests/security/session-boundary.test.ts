import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { prisma } from "@/lib/prisma";
import { isPublicApiPath } from "@/lib/permissions";

import { clearSession, setSession } from "../helpers/session";

import { GET as contactsGET } from "@/app/api/contacts/route";
import { GET as scanGET, POST as scanPOST } from "@/app/api/scan/route";
import { GET as profileGET } from "@/app/api/profile/[id]/route";
import { POST as enrichPOST } from "@/app/api/profile/enrich/route";
import { POST as locationsPOST } from "@/app/api/locations/route";
import { POST as batchPOST } from "@/app/api/locations/batch/route";
import { POST as resolvePOST } from "@/app/api/locations/resolve/route";
import { POST as cacheCheckPOST } from "@/app/api/locations/cache-check/route";

import { GET as healthGET } from "@/app/api/health/route";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import {
  GET as nextAuthGET,
  POST as nextAuthPOST,
} from "@/app/api/auth/[...nextauth]/route";

/** NextRequest narrows the DOM RequestInit; take the type it actually wants. */
type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

const req = (path: string, init?: NextRequestInit) =>
  new NextRequest(new URL(path, "http://localhost"), init);

/**
 * A protected handler, invoked the way a real request would reach it.
 *
 * The `file` and `verb` are carried alongside the closure rather than folded
 * into a label string, because they are what `covers every protected route
 * file on disk` compares against the filesystem. Parsing them back out of a
 * label would reintroduce the coupling the staleness test exists to break.
 */
type ProtectedCase = {
  /** Repo-relative route file, e.g. `app/api/profile/[id]/route.ts`. */
  file: string;
  verb: string;
  /** Human label for the it.each title. */
  label: string;
  invoke: () => Promise<Response>;
};

/**
 * Every route handler that must refuse an anonymous caller.
 *
 * This list is not the source of truth for which routes are protected --
 * route-enumeration.test.ts derives that from the filesystem and it is the
 * authoritative sweep. What this list adds is per-handler invocation with real
 * `params` promises and a real FormData body, which a generic sweep cannot do.
 * It can therefore rot, so `covers every protected route file on disk` fails
 * the moment it diverges from what is actually on disk.
 */
const PROTECTED: ProtectedCase[] = [
  {
    file: "app/api/contacts/route.ts",
    verb: "GET",
    label: "GET /api/contacts",
    invoke: () => contactsGET(),
  },
  {
    file: "app/api/scan/route.ts",
    verb: "GET",
    label: "GET /api/scan",
    invoke: () => scanGET(),
  },
  {
    file: "app/api/profile/[id]/route.ts",
    verb: "GET",
    label: "GET /api/profile/[id]",
    invoke: () =>
      profileGET(req("/api/profile/abc"), {
        params: Promise.resolve({ id: "abc" }),
      } as never),
  },
  {
    file: "app/api/scan/route.ts",
    verb: "POST",
    label: "POST /api/scan",
    invoke: () => scanPOST(req("/api/scan", { method: "POST" })),
  },
  {
    file: "app/api/profile/enrich/route.ts",
    verb: "POST",
    label: "POST /api/profile/enrich",
    invoke: () => enrichPOST(req("/api/profile/enrich", { method: "POST" })),
  },
  {
    file: "app/api/locations/route.ts",
    verb: "POST",
    label: "POST /api/locations",
    invoke: () => locationsPOST(req("/api/locations", { method: "POST" })),
  },
  {
    file: "app/api/locations/batch/route.ts",
    verb: "POST",
    label: "POST /api/locations/batch",
    invoke: () => batchPOST(req("/api/locations/batch", { method: "POST" })),
  },
  {
    file: "app/api/locations/resolve/route.ts",
    verb: "POST",
    label: "POST /api/locations/resolve",
    invoke: () => resolvePOST(req("/api/locations/resolve", { method: "POST" })),
  },
  {
    file: "app/api/locations/cache-check/route.ts",
    verb: "POST",
    label: "POST /api/locations/cache-check",
    invoke: () => cacheCheckPOST(req("/api/locations/cache-check", { method: "POST" })),
  },
];

/**
 * Every `route.ts` under `app/api`, at any depth, repo-relative and
 * forward-slashed.
 *
 * Same recursive walk as the enumeration sweep: a flat one-level scan of
 * `app/api` finds nothing at depth 3, which is where three of these live.
 */
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

/**
 * The concrete URL a route file is reached at, which is what `isPublicApiPath`
 * is written against: `[id]` becomes `probe-id` and a catch-all becomes
 * `probe`, because `PUBLIC_API_PATHS` lists `/api/auth/probe`, not a wildcard.
 *
 * Deliberately the same transform the enumeration sweep applies. The sweep
 * holds the authoritative copy; this one exists only so the staleness test
 * below classifies the same routes the production allowlist classifies.
 */
function concretePath(file: string): string {
  const segments = file
    .replace(/^app\//, "")
    .replace(/\/route\.ts$/, "")
    .split("/")
    .map((segment) => {
      if (!segment.startsWith("[")) return segment;

      const inner = segment.slice(1, -1).replace(/^\[+/, "").replace(/\]+$/, "");

      // A catch-all collapses to a single `probe` segment, NOT to its param
      // name. PUBLIC_API_PATHS lists `/api/auth/probe` for `[...nextauth]`,
      // because the enumeration sweep maps every catch-all to that one string.
      return inner.startsWith("...") ? "probe" : "probe-id";
    });

  return `/${segments.join("/")}`;
}

/**
 * The protected set, derived rather than declared.
 *
 * Public-ness comes from `isPublicApiPath` in lib/permissions.ts -- the
 * production classifier, imported so this file cannot be edited independently
 * of the allowlist. That is what removes the need for the `PUBLIC_ROUTES`
 * array this replaced: it asserted only that a route file's source did not
 * contain the string `requireApiSession`, which is true of any file that never
 * had a guard, and it did not fail when a route was added or removed.
 */
const PROTECTED_FILES_ON_DISK = routeFilesOnDisk().filter(
  (file) => !isPublicApiPath(concretePath(file))
);

const readRepoFile = (relative: string) =>
  readFileSync(resolve(process.cwd(), relative), "utf8");

const UNAUTHORIZED_BODY = { success: false, error: "Unauthorized." };

/** A `vi.fn()` reduced to the one field an assertion needs. */
type MockDelegate = { mock: { calls: unknown[][] } };

/**
 * Every delegate on the mocked Prisma surface, named by its full path.
 *
 * A walk, not a list. The four hand-named delegates this replaces missed four
 * of the eight tests/setup.ts defines -- `contact.findFirst`,
 * `contact.findUnique` (the first call in app/api/profile/[id]/route.ts),
 * `locationCache.findUnique` (the first call in all four location routes), and
 * the `user` / `passwordResetToken` groups. A guard that drifted below any of
 * them left this assertion green.
 *
 * A function on the surface that is not a `vi.fn()` fails by name instead of
 * being skipped: dropping it silently would restore the vacuous assertion.
 */
function prismaDelegates(): Array<{ path: string; fn: MockDelegate }> {
  const surface = prisma as unknown as Record<string, Record<string, unknown>>;
  const found: Array<{ path: string; fn: MockDelegate }> = [];

  for (const [model, methods] of Object.entries(surface)) {
    for (const [method, value] of Object.entries(methods ?? {})) {
      if (typeof value !== "function") continue;

      const fn = value as Partial<MockDelegate>;

      if (!fn.mock || !Array.isArray(fn.mock.calls)) {
        throw new Error(
          `prisma.${model}.${method} is not a vi.fn(). tests/setup.ts must build ` +
            `every Prisma delegate with vi.fn(), or the side-effect walk asserts nothing.`
        );
      }

      found.push({ path: `prisma.${model}.${method}`, fn: fn as MockDelegate });
    }
  }

  return found;
}

/**
 * The concrete form of "the route body never ran": no read, no write, no cache
 * fill. A handler that reached its own logic would move at least one of these.
 */
const expectNoPrismaWork = () => {
  const called = prismaDelegates()
    .filter(({ fn }) => fn.mock.calls.length > 0)
    .map(({ path, fn }) => `${path} (${fn.mock.calls.length} call(s))`);

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
};

afterEach(async () => {
  await clearSession();
  vi.clearAllMocks();
});

describe("SEC-01: an unauthenticated caller is refused before route logic runs", () => {
  it.each(PROTECTED)(
    "$label returns 401 and the fixed error envelope",
    async ({ invoke }) => {
      const response = await invoke();

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
      expectNoPrismaWork();
    }
  );

  it("covers every protected route file on disk", () => {
    // The staleness check that lets PROTECTED stay a hand-written list at all.
    //
    // It is a two-way set comparison, not a membership spot-check. The review's
    // sketch asserted only that `app/api/contacts/` was in the discovered set,
    // which is a tautology -- it holds whatever else has rotted. Both
    // directions matter and they fail for different reasons:
    //
    //   uncovered -- a route file exists, the production allowlist does not
    //     exempt it, and PROTECTED has no case for it, so the per-handler
    //     invocation with real params and a real FormData body silently stops
    //     covering it.
    //   stale -- PROTECTED names a file that is no longer protected: it was
    //     deleted, renamed, or added to PUBLIC_API_PATHS. A renamed file fails
    //     the static import outright; the allowlist case is the one that would
    //     otherwise sit here quietly.
    //
    // A case is counted once per file, so a file with two verbs (app/api/scan)
    // does not appear twice on the covered side.
    const declared = [...new Set(PROTECTED.map((entry) => entry.file))].sort();
    const uncovered = PROTECTED_FILES_ON_DISK.filter(
      (file) => !declared.includes(file)
    );
    const stale = declared.filter((file) => !PROTECTED_FILES_ON_DISK.includes(file));

    // Non-vacuous: a walk that found no protected routes would satisfy both
    // halves of the comparison above with nothing to compare.
    expect(PROTECTED_FILES_ON_DISK.length).toBeGreaterThan(0);
    expect(PROTECTED.length).toBeGreaterThan(0);

    expect(
      { uncovered, stale },
      [
        "PROTECTED no longer matches the routes on disk. This list exists only to",
        "drive per-handler invocations with real params and FormData bodies;",
        "tests/security/route-enumeration.test.ts is the authoritative sweep.",
        "",
        "  uncovered -- on disk, protected by lib/permissions.ts, and not in PROTECTED:",
        ...uncovered.map((file) => `    + ${file}`),
        "  stale -- in PROTECTED, but not a protected route file on disk:",
        ...stale.map((file) => `    - ${file}`),
        "",
        "Add a case with its invoke() for each uncovered file, and remove the case",
        "for each stale one (renamed, deleted, or now on PUBLIC_API_PATHS).",
      ].join("\n")
    ).toEqual({ uncovered: [], stale: [] });
  });

  it("refuses POST /api/scan with 401 before the multipart body is read", async () => {
    // The strongest form of "before route logic": if the guard ever moved below
    // req.formData(), this body would be buffered and then hit the OpenAI path.
    // tests/setup.ts additionally replaces the openai default export with a
    // class that throws on construction, so a reached extractCardFromImage()
    // would fail the test rather than issue a billable request.
    const form = new FormData();
    form.append(
      "image",
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "card.png", {
        type: "image/png",
      })
    );

    const response = await scanPOST(
      req("/api/scan", { method: "POST", body: form })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
    expectNoPrismaWork();
  });

  it("does not leak contact data in the 401 body from GET /api/contacts", async () => {
    const response = await contactsGET();
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(body).not.toContain("email");
    expect(body).not.toContain("phone");
    expect(JSON.parse(body)).toEqual(UNAUTHORIZED_BODY);
  });
});

describe("SEC-02: an authenticated caller reaches the handler", () => {
  it.each(PROTECTED)("$label is not refused when a session exists", async ({
    invoke,
  }) => {
    await setSession();

    const response = await invoke();

    // Deliberately not a specific status: with infrastructure mocked the
    // handlers legitimately return 200, 400, 404 or 500 depending on how far
    // they get. Anything other than 401 proves the guard let them through.
    expect(response.status).not.toBe(401);
  });

  it("serves the contact list from Prisma with a session", async () => {
    await setSession();

    const response = await contactsGET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(vi.mocked(prisma.contact.findMany)).toHaveBeenCalledTimes(1);
  });
});

describe("SEC-03: the public routes stay reachable without a session", () => {
  it("serves GET /api/health with no session", async () => {
    const response = await healthGET();

    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ok");
  });

  it("registers a new user through POST /api/auth/register with no session", async () => {
    const response = await registerPOST(
      req("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "A",
          email: "a@b.co",
          password: "password123",
        }),
      })
    );

    expect(response.status).toBe(201);
    // Proof the handler's own logic ran, which is the whole point of SEC-03.
    expect(vi.mocked(prisma.user.create)).toHaveBeenCalledTimes(1);
  });

  it("leaves the NextAuth catch-all ungated", async () => {
    expect(nextAuthGET).toBeTypeOf("function");
    expect(nextAuthPOST).toBeTypeOf("function");

    let invocationWorked = true;
    try {
      // next-auth v4's NextAuth() returns (req, res) => ... and only dispatches to
      // the App Router handler when the second argument carries route params.
      // Without it the call falls into the Pages Router branch and throws on
      // req.query, which is a test-shape artifact, not an application bug.
      const response = await nextAuthGET(req("/api/auth/session"), {
        params: Promise.resolve({ nextauth: ["session"] }),
      } as never);
      expect(response.status).not.toBe(401);
    } catch {
      // Unavoidable in a unit test: NextAuthRouteHandler reads the async
      // `cookies()` context from next/headers, which only exists inside a live
      // Next.js request scope. The structural check is the sanctioned fallback.
      invocationWorked = false;
    }

    if (!invocationWorked) {
      expect(readRepoFile("app/api/auth/[...nextauth]/route.ts")).not.toContain(
        "requireApiSession"
      );
    }
  });
});
