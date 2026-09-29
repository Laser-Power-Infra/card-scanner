import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { prisma } from "@/lib/prisma";

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

/** Every route handler that must refuse an anonymous caller. */
const PROTECTED: Array<[string, () => Promise<Response>]> = [
  ["GET /api/contacts", () => contactsGET()],
  ["GET /api/scan", () => scanGET()],
  [
    "GET /api/profile/[id]",
    () =>
      profileGET(req("/api/profile/abc"), {
        params: Promise.resolve({ id: "abc" }),
      } as never),
  ],
  ["POST /api/scan", () => scanPOST(req("/api/scan", { method: "POST" }))],
  [
    "POST /api/profile/enrich",
    () => enrichPOST(req("/api/profile/enrich", { method: "POST" })),
  ],
  [
    "POST /api/locations",
    () => locationsPOST(req("/api/locations", { method: "POST" })),
  ],
  [
    "POST /api/locations/batch",
    () => batchPOST(req("/api/locations/batch", { method: "POST" })),
  ],
  [
    "POST /api/locations/resolve",
    () => resolvePOST(req("/api/locations/resolve", { method: "POST" })),
  ],
  [
    "POST /api/locations/cache-check",
    () => cacheCheckPOST(req("/api/locations/cache-check", { method: "POST" })),
  ],
];

/** The five route files that must stay reachable without a session cookie. */
const PUBLIC_ROUTES = [
  "app/api/health/route.ts",
  "app/api/auth/[...nextauth]/route.ts",
  "app/api/auth/register/route.ts",
  "app/api/auth/forgot-password/route.ts",
  "app/api/auth/reset-password/route.ts",
];

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
  it.each(PROTECTED)("%s returns 401 and the fixed error envelope", async (
    _label,
    invoke
  ) => {
    const response = await invoke();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
    expectNoPrismaWork();
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
  it.each(PROTECTED)("%s is not refused when a session exists", async (
    _label,
    invoke
  ) => {
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

  it.each(PUBLIC_ROUTES)(
    "%s never references requireApiSession",
    (relative) => {
      expect(readRepoFile(relative)).not.toContain("requireApiSession");
    }
  );
});
