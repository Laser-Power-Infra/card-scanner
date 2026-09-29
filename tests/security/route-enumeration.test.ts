import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { prisma } from "@/lib/prisma";
import { PUBLIC_API_PATHS, isPublicApiPath } from "@/lib/permissions";

import { clearSession } from "../helpers/session";

/**
 * SEC-06: the auth boundary is proven for every route handler that exists on
 * disk, not for a list this file happens to remember.
 *
 * Everything below is derived from the filesystem at run time. There is no
 * literal array of routes in this file, and that is the whole point: a
 * hand-written list is a snapshot that a newly added app/api/**\/route.ts walks
 * straight past, which is exactly the regression SEC-06 exists to close. The
 * public exemption is likewise imported from lib/permissions.ts rather than
 * redeclared here, so a route cannot be exempted by editing only its test.
 */

const REPO_ROOT = process.cwd();
const API_DIR = resolve(REPO_ROOT, "app", "api");

/**
 * The exact set of `route.ts` files under app/api.
 *
 * A list, not a count. A count is red for three indistinguishable outcomes -- a
 * legitimate addition, a deletion, and a new unguarded route under a public
 * namespace -- and its failure message used to say only "update the count",
 * which is a remedy a developer can apply without ever reading what changed.
 * The diff below names the paths, so a blind bump is no longer a possible
 * response to the message.
 *
 * Deliberately exact rather than a subset check: a subset check cannot notice a
 * deleted route, and that is how a route stops being covered silently.
 */
const EXPECTED_ROUTE_FILES = [
  "app/api/auth/[...nextauth]/route.ts",
  "app/api/auth/forgot-password/route.ts",
  "app/api/auth/register/route.ts",
  "app/api/auth/reset-password/route.ts",
  "app/api/contacts/route.ts",
  "app/api/health/route.ts",
  "app/api/locations/batch/route.ts",
  "app/api/locations/cache-check/route.ts",
  "app/api/locations/resolve/route.ts",
  "app/api/locations/route.ts",
  "app/api/profile/[id]/route.ts",
  "app/api/profile/enrich/route.ts",
  "app/api/scan/route.ts",
] as const;

/** Same comparator as discoverRoutes(), so the two sides cannot disagree on order. */
const byPath = (a: string, b: string) => a.localeCompare(b);

/**
 * Turn a set mismatch into the lines a developer needs, so the assertion fails
 * with the answer rather than with a number to reconcile by hand.
 */
function describeSetDiff(expected: readonly string[], actual: readonly string[]): string[] {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const added = actual.filter((path) => !expectedSet.has(path));
  const removed = expected.filter((path) => !actualSet.has(path));

  if (added.length === 0 && removed.length === 0) return ["  (same set, different order)"];

  return [
    ...added.map((path) => `  + ${path}  (on disk, not in EXPECTED_ROUTE_FILES)`),
    ...removed.map((path) => `  - ${path}  (in EXPECTED_ROUTE_FILES, not on disk)`),
  ];
}

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;
type RouteModule = Record<string, unknown>;
type Handler = (...args: unknown[]) => Promise<Response>;

const HTTP_VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Verb = (typeof HTTP_VERBS)[number];

type DiscoveredRoute = {
  /** Absolute path on disk, used for both the import and the source read. */
  abs: string;
  /** Repo-relative, forward-slashed, e.g. `app/api/profile/[id]/route.ts`. */
  rel: string;
  /** Concrete URL the handler would be reached at, e.g. `/api/profile/probe-id`. */
  urlPath: string;
  /** Dynamic segment values, ready to resolve as a Next.js `params` promise. */
  params: Record<string, string>;
};

type RouteEntry = DiscoveredRoute & {
  mod: RouteModule;
  isPublic: boolean;
  verbs: Verb[];
};

/**
 * Turn one path segment into something a handler can actually be called with.
 *
 * A dynamic segment has no concrete URL, and the handler is going to be
 * invoked, so `[id]` becomes `probe-id` and a catch-all becomes `probe`. Static
 * segments pass through untouched.
 */
function concreteSegment(segment: string): { text: string; param: string | null } {
  if (!segment.startsWith("[")) return { text: segment, param: null };

  // `[[...slug]]` is optional-catch-all in the App Router; peel both bracket
  // layers so the param name is the same shape as a plain dynamic segment.
  const inner = segment
    .slice(1, -1)
    .replace(/^\[+/, "")
    .replace(/\]+$/, "");

  const isCatchAll = inner.startsWith("...");

  return {
    text: isCatchAll ? "probe" : "probe-id",
    param: isCatchAll ? inner.slice(3) : inner,
  };
}

function toRoute(abs: string): DiscoveredRoute {
  const rel = relative(REPO_ROOT, abs).split(sep).join("/");
  const segments = rel
    .replace(/^app\//, "")
    .replace(/\/route\.ts$/, "")
    .split("/");

  const params: Record<string, string> = {};

  const concrete = segments.map((segment) => {
    const { text, param } = concreteSegment(segment);

    if (param) params[param] = text;

    return text;
  });

  return { abs, rel, urlPath: `/${concrete.join("/")}`, params };
}

/** Recursive directory walk. Skips nothing, so a new nested route is found. */
function discoverRoutes(): DiscoveredRoute[] {
  const found: DiscoveredRoute[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);

      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name === "route.ts") found.push(toRoute(abs));
    }
  };

  walk(API_DIR);

  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

const moduleCache = new Map<string, Promise<RouteModule>>();

/**
 * Load a route module by absolute filesystem path.
 *
 * The plain absolute-path form is used, not `pathToFileURL(...).href` and not
 * a `@vite-ignore` comment: Vitest routes the dynamic import through its own
 * module graph either way, which is what makes the `vi.mock` declarations in
 * tests/setup.ts apply to a handler imported from a variable. A `@vite-ignore`
 * escape hatch would hand the import to native ESM, load the real
 * @/lib/prisma, and open a socket -- the opposite of the intent.
 */
const loadRouteModule = (abs: string): Promise<RouteModule> => {
  let pending = moduleCache.get(abs);

  if (!pending) {
    pending = import(abs).then((loaded) => loaded as RouteModule);
    moduleCache.set(abs, pending);
  }

  return pending;
};

const ROUTES = discoverRoutes();

const entries: RouteEntry[] = await Promise.all(
  ROUTES.map(async (route) => {
    const mod = await loadRouteModule(route.abs);

    return {
      ...route,
      mod,
      // The exemption comes from production code, so widening it is a reviewed
      // change to lib/permissions.ts rather than an edit to a test.
      isPublic: isPublicApiPath(route.urlPath),
      verbs: HTTP_VERBS.filter((verb) => typeof mod[verb] === "function"),
    };
  })
);

const publicEntries = entries.filter((entry) => entry.isPublic);
const protectedEntries = entries.filter((entry) => !entry.isPublic);

type ProtectedCase = { label: string; entry: RouteEntry; verb: Verb };

const protectedCases: ProtectedCase[] = protectedEntries.flatMap((entry) =>
  entry.verbs.map((verb) => ({ label: `${verb} ${entry.urlPath}`, entry, verb }))
);

const multipartCases = protectedCases.filter((c) => c.verb !== "GET");

/** NextRequest narrows the DOM RequestInit; take the type it actually wants. */
function buildRequest(entry: RouteEntry, verb: Verb, body?: BodyInit): NextRequest {
  const init: NextRequestInit = { method: verb };

  // A GET may not carry a body; every other verb may, and for the multipart
  // routes the body is the point of the test.
  if (body !== undefined) init.body = body;

  return new NextRequest(new URL(entry.urlPath, "http://localhost"), init);
}

async function invokeHandler(
  entry: RouteEntry,
  verb: Verb,
  body?: BodyInit
): Promise<Response> {
  const handler = entry.mod[verb] as Handler;

  const takesRequest = !(verb === "GET" && handler.length === 0);
  const args: unknown[] = takesRequest ? [buildRequest(entry, verb, body)] : [];

  if (takesRequest && Object.keys(entry.params).length > 0) {
    args.push({ params: Promise.resolve(entry.params) });
  }

  return handler(...args);
}

const UNAUTHORIZED_BODY = { success: false, error: "Unauthorized." };

/**
 * The concrete form of "the route body never ran". A handler that reached its
 * own logic would move at least one of these before answering 401.
 */
const expectNoRouteSideEffects = () => {
  expect(vi.mocked(prisma.contact.findMany)).not.toHaveBeenCalled();
  expect(vi.mocked(prisma.contact.findUnique)).not.toHaveBeenCalled();
  expect(vi.mocked(prisma.contact.create)).not.toHaveBeenCalled();
  expect(vi.mocked(prisma.contact.update)).not.toHaveBeenCalled();
  expect(vi.mocked(prisma.locationCache.upsert)).not.toHaveBeenCalled();
};

/** The two exemptions SEC-03 names, located by path rather than by import. */
const healthEntry = entries.find((entry) => entry.urlPath === "/api/health");
const registerEntry = entries.find((entry) => entry.urlPath === "/api/auth/register");

/**
 * `/api/auth` and `/api/health` are namespaces, not leaves. Membership of a
 * namespace says nothing about a route inside it -- under the old prefix
 * allowlist, anything at `app/api/auth/**` was exempted on arrival.
 */
const PUBLIC_NAMESPACES = ["/api/auth", "/api/health"] as const;

/**
 * The NextAuth catch-all: the one public entry that cannot be invoked here.
 *
 * Its handlers are next-auth internals that need a live request scope (a real
 * Request, a cookie jar, an Auth.js event) and are not plain route functions,
 * so it is asserted structurally instead of behaviourally. Recorded as
 * `human_judgment: true` on SEC-03 in
 * .planning/phases/01-verification-harness-and-auth-boundary/01-01-SUMMARY.md.
 */
const NEXTAUTH_CATCH_ALL = "app/api/auth/[...nextauth]/route.ts";

const invokablePublicEntries = publicEntries.filter((e) => e.rel !== NEXTAUTH_CATCH_ALL);
const sourceCheckedPublicEntries = publicEntries.filter((e) => e.rel === NEXTAUTH_CATCH_ALL);

type PublicCase = { label: string; entry: RouteEntry; verb: Verb };

const publicCases: PublicCase[] = invokablePublicEntries.flatMap((entry) =>
  entry.verbs.map((verb) => ({ label: `${verb} ${entry.rel}`, entry, verb }))
);

afterEach(async () => {
  await clearSession();
  vi.clearAllMocks();
});

describe("SEC-06: the auth boundary is proven for every route handler on disk", () => {
  it("discovers every app/api/**/route.ts from the filesystem", () => {
    const found = ROUTES.map((route) => route.rel);

    expect(
      [...found].sort(byPath),
      [
        "The set of route files under app/api changed.",
        "For an ADDED route, the 401 sweep above already ran against it.",
        "  If it is public, add its exact path to PUBLIC_API_PATHS in lib/permissions.ts.",
        "  If it is protected, it needs a requireApiSession() guard.",
        "For a REMOVED or RENAMED route, delete or update its line in",
        "EXPECTED_ROUTE_FILES in this file.",
        "",
        "Diff:",
        ...describeSetDiff(EXPECTED_ROUTE_FILES, found),
      ].join("\n")
    ).toEqual([...EXPECTED_ROUTE_FILES].sort(byPath));

    // Proves the walk recursed rather than globbing one level: a flat
    // app/api/*/route.ts scan finds nothing at depth 3.
    expect(found.some((rel) => rel.split("/").length > 4)).toBe(true);
  });

  it("resolves every discovered route through lib/permissions, with none unclassified", () => {
    expect(publicEntries.length + protectedEntries.length).toBe(ROUTES.length);
    // A tree of nothing but exemptions would technically satisfy the sum above.
    expect(protectedEntries.length).toBeGreaterThan(0);
  });

  it("matches the public allowlist by exact equality, not by prefix", () => {
    // Every entry on the production allowlist classifies as public, so the two
    // cannot drift apart: the list is read from lib/permissions.ts, not restated.
    for (const path of PUBLIC_API_PATHS) {
      expect(
        isPublicApiPath(path),
        `${path} is on PUBLIC_API_PATHS but isPublicApiPath says otherwise`
      ).toBe(true);
    }

    // A prefix match re-opens the hole the exact set closes: "/api/healthz"
    // exempted by "/api/health", and every future child of "/api/auth"
    // exempted by "/api/auth" -- which is how app/api/auth/admin-export
    // shipped unguarded while this suite reported it green.
    expect(isPublicApiPath("/api/healthz")).toBe(false);
    expect(isPublicApiPath("/api/authentic")).toBe(false);
    expect(isPublicApiPath("/api/auth")).toBe(false);
    expect(isPublicApiPath("/api/auth/signin")).toBe(false);
    expect(isPublicApiPath("/api/auth/admin-export")).toBe(false);
    expect(isPublicApiPath("/api/contacts")).toBe(false);
  });

  it("exempts no route that merely lives under a public namespace", () => {
    // The failure the prefix allowlist made unrepresentable. Naming the file
    // is the point: the developer has to decide whether the route is genuinely
    // public (and add its exact path to PUBLIC_API_PATHS) or needs a
    // requireApiSession() guard. Bumping a count would not tell them which.
    const smuggled = entries
      .filter((entry) => !entry.isPublic)
      .filter((entry) =>
        PUBLIC_NAMESPACES.some(
          (ns) => entry.urlPath === ns || entry.urlPath.startsWith(`${ns}/`)
        )
      )
      .map((entry) => entry.rel);

    expect(
      smuggled,
      [
        "These routes live under a public namespace but are NOT on PUBLIC_API_PATHS,",
        "so they are classified protected and were asserted to answer 401. One of",
        "them answered something else, which means the exemption and the allowlist",
        "disagree about what /api/auth and /api/health mean.",
        "",
        "For each: if it is genuinely public, add its exact path to PUBLIC_API_PATHS",
        "in lib/permissions.ts. If it is not, give it a requireApiSession() guard.",
        "",
        "Offending files:",
        ...smuggled,
      ].join("\n")
    ).toEqual([]);
  });

  describe("protected routes", () => {
    it.each(protectedCases)(
      "$label returns 401 and the fixed error envelope",
      async ({ entry, verb }) => {
        const handler = entry.mod[verb];

        // A module exporting no HTTP verb is a failure, not a silent skip.
        expect(typeof handler, `${verb} ${entry.rel} exports no ${verb} handler`).toBe(
          "function"
        );

        const response = await invokeHandler(entry, verb);

        expect(response.status).toBe(401);
        // The guard's exact envelope. No handler's own catch block produces
        // this string, so a throwing guard cannot pass for a guarded one.
        expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
        expectNoRouteSideEffects();
      }
    );
  });

  describe("protected routes that accept a body", () => {
    // The stronger form of "before route logic": a multipart body is what the
    // scan route buffers first, so if the guard ever moved below req.formData()
    // or req.json() this assertion turns red instead of reaching the OpenAI
    // path. tests/setup.ts backs that up by making `new OpenAI(...)` throw.
    it.each(multipartCases)(
      "$label returns 401 before the multipart body is read",
      async ({ entry, verb }) => {
        const form = new FormData();
        form.append(
          "image",
          new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "card.png", {
            type: "image/png",
          })
        );

        const response = await invokeHandler(entry, verb, form);

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
        expectNoRouteSideEffects();
      }
    );
  });

  describe("public routes", () => {
    it.each(publicEntries.map((entry) => ({ label: entry.rel, entry })))(
      "$label exports at least one HTTP verb",
      ({ entry }) => {
        expect(
          entry.verbs.length,
          `${entry.rel} exports none of ${HTTP_VERBS.join(", ")}`
        ).toBeGreaterThan(0);
      }
    );

    // Behavioural, not a grep. The old assertion was
    // `readFileSync(entry.abs).not.toContain("requireApiSession")`, which a
    // route with NO guard at all satisfies -- it never had the string to
    // contain. "Public" now means "reachable with no session", which is the
    // property SEC-03 actually claims and the only one an attacker tests.
    it.each(publicCases)(
      "$label answers with something other than 401 when called with no session",
      async ({ entry, verb }) => {
        // An empty JSON object is the cheapest well-formed body: the auth routes
        // answer 400 on it, which is still proof the handler ran.
        const body = verb === "GET" ? undefined : JSON.stringify({});

        const response = await invokeHandler(entry, verb, body);

        expect(
          response.status,
          `${verb} ${entry.rel} is on PUBLIC_API_PATHS but answered ${response.status} ` +
            `with no session. A public route must be reachable, so 401 here means the ` +
            `allowlist and the handler disagree about this route.`
        ).not.toBe(401);
      }
    );

    it.each(sourceCheckedPublicEntries.map((entry) => ({ label: entry.rel, entry })))(
      "$label is the next-auth catch-all, so it is checked structurally",
      ({ entry }) => {
        expect(readFileSync(entry.abs, "utf8")).not.toContain("requireApiSession");
      }
    );

    it("serves GET /api/health with no session", async () => {
      expect(healthEntry).toBeDefined();

      const response = await invokeHandler(healthEntry!, "GET");

      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe("ok");
    });

    it("registers a new user through POST /api/auth/register with no session", async () => {
      expect(registerEntry).toBeDefined();

      const response = await invokeHandler(
        registerEntry!,
        "POST",
        JSON.stringify({ name: "A", email: "a@b.co", password: "password123" })
      );

      expect(response.status).toBe(201);
      // Proof the handler's own logic ran, which is the whole point of SEC-03.
      expect(vi.mocked(prisma.user.create)).toHaveBeenCalledTimes(1);
    });
  });
});
