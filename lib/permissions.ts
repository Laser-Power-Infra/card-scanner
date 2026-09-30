import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export enum Role {
  USER = "USER",
  ADMIN = "ADMIN",
  DEVELOPER = "DEVELOPER",
}

/**
 * The exact routes reachable without a session. Everything else under /api/ is
 * gated by requireApiSession.
 *
 * There are two kinds of entry here, and conflating them is how the boundary
 * rots:
 *
 *   1. Routes that are public by NATURE -- liveness, and the NextAuth
 *      registration and password-reset handlers. They carry no tenant data and
 *      no capability, so an anonymous caller losing nothing.
 *
 *   2. Routes that are public by DECISION -- the read and scan surface an
 *      anonymous visitor is entitled to. The directory is world-readable on
 *      purpose; only the researched `Enrichment` rows are withheld. Those
 *      handlers do not call `requireApiSession()` because they are not supposed
 *      to refuse anyone: they read the session in order to decide how much of
 *      the response to shape (see `getCurrentSession()` in the two contact
 *      routes). Widening this list without changing the handler is a bug; both
 *      halves are reviewed together.
 *
 * Exact paths, NOT prefixes, and that is the whole point. `/api/auth` is a
 * namespace, not a leaf: it already contains four routes and nothing stops a
 * fifth. Under the old prefix list, dropping `app/api/auth/admin-export/route.ts`
 * -- a handler returning every Contact row with no guard at all -- was silently
 * exempted, and the boundary suite reported it green, because a grep for the
 * string `requireApiSession` in the source is satisfied by a route that has no
 * guard. With exact equality the exemption cannot widen: adding a route is not
 * adding a route to this list, it is adding a row to the boundary test.
 *
 * Dynamic segments are listed by the concrete path the boundary suite resolves
 * them to, not by the on-disk segment name: `/api/auth/probe` is
 * `[...nextauth]`, and `/api/profile/probe-id` is `[id]`. A second catch-all
 * under /api/auth would resolve to that same concrete path, which is the one
 * hole a pure path set cannot close on its own; the exact route-file list in
 * tests/security/route-enumeration.test.ts is what names the new file.
 *
 * This is the classifier the boundary suite reads, not a runtime gate. The
 * load-bearing enforcement is the per-handler `requireApiSession()` call; do
 * not add an `if (isPublicApiPath(...))` to middleware.ts and read the two as
 * one mechanism.
 */
export const PUBLIC_API_PATHS = [
  // Public by nature.
  "/api/health",
  "/api/auth/probe",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",

  // Public by decision. `requireApiSession` is absent from these handlers on
  // purpose; the contact routes still read the session, but only to narrow the
  // `enrichment` select. `/api/profile/enrich`, `/api/locations` and
  // `/api/locations/batch` deliberately stay off this list: they are heavier
  // capabilities (a synchronous LLM call, unmetered geocoding) with no
  // anonymous consumer.
  "/api/contacts",
  "/api/profile/probe-id",
  "/api/scan",
  "/api/locations/resolve",
  "/api/locations/cache-check",
] as const;

/**
 * Exact equality, deliberately. A prefix or `startsWith` here re-opens the hole
 * above: "/api/healthz" would be exempted by "/api/health", and every future
 * route under "/api/auth/" would be exempted by "/api/auth".
 *
 * THIS IS NOT A RUNTIME GATE. Nothing in the running application calls it --
 * `middleware.ts` does not, and it must not start to. Its only consumer is
 * tests/security/route-enumeration.test.ts, which uses it to classify a route
 * file it discovered on disk so the test knows which handlers to expect a 401
 * from. It lives in production code, rather than in the test, so that the test
 * cannot be edited independently of what production considers public: delete
 * an entry here and the suite goes red.
 *
 * The mechanism that actually denies an anonymous caller is the per-handler
 * `requireApiSession()` call at the top of every non-public handler. The two
 * are unrelated and only one is load-bearing. If you add
 * `if (isPublicApiPath(path)) return NextResponse.next()` to middleware.ts you
 * will not have centralised the boundary -- you will have added a second,
 * untested, default-open one next to the real one, while the real one keeps
 * running unchanged underneath.
 */
export function isPublicApiPath(pathname: string): boolean {
  return (PUBLIC_API_PATHS as readonly string[]).includes(pathname);
}

/**
 * Get the current logged-in session
 */
export async function getCurrentSession() {
  return await getServerSession(authOptions);
}

/**
 * Check if user is logged in
 */
export async function isAuthenticated() {
  const session = await getCurrentSession();

  return !!session?.user;
}

/**
 * Check if logged-in user is an Admin
 */
export async function isAdmin() {
  const session = await getCurrentSession();

  return session?.user?.role === Role.ADMIN;
}

/**
 * Check if logged-in user is a Developer
 */
export async function isDeveloper() {
  const session = await getCurrentSession();

  return session?.user?.role === Role.DEVELOPER;
}

/**
 * Require authentication
 * Throws an error if user is not logged in.
 */
export async function requireAuth() {
  const session = await getCurrentSession();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  return session;
}

/**
 * Require Admin role
 * Throws an error if user is not an admin.
 */
export async function requireAdmin() {
  const session = await requireAuth();

  if (session.user.role !== Role.ADMIN) {
    throw new Error("Forbidden");
  }

  return session;
}

/**
 * Check if current user owns a resource
 */
export function isOwner(
  ownerId: string,
  currentUserId: string
) {
  return ownerId === currentUserId;
}

/**
 * The single place an API session is read.
 *
 * requireApiSession() and requireApiRole() both need the same two facts -- is
 * there a session, and what is its role -- and the role check must never be
 * reachable without a confirmed session. Reading the cookie once and returning
 * a discriminated result keeps the 401 envelope and its log line in one place
 * and removes the second getCurrentSession() that used to sit in requireApiRole.
 * That second read was not a security defect: the ordering was correct. It was
 * a correctness-of-intent gap, invisible to the suite because the next-auth
 * seam is a mockResolvedValue, so both reads returned the same object for free.
 * tests/security/role-boundary.test.ts now pins the read count at exactly one on
 * all three paths (401, 403, 200), so a reordering or a third read goes red.
 */
type ApiSessionResult =
  | { denied: NextResponse }
  | { session: Session };

async function resolveApiSession(): Promise<ApiSessionResult> {
  const session = await getCurrentSession();

  if (!session?.user) {
    // No URL, cookie, or header in this line: it must not become a leak vector.
    console.warn("[Auth] Rejected unauthenticated API request");

    return {
      denied: NextResponse.json(
        { success: false, error: "Unauthorized." },
        { status: 401 }
      ),
    };
  }

  return { session };
}

/**
 * Gate a route handler on an authenticated session.
 * Returns null when the caller may proceed, or the 401 response to return as-is.
 *
 * Deliberately not a throwing check like requireAuth: a route handler has to
 * return a response rather than propagate, so the handler becomes
 * `const denied = await requireApiSession(); if (denied) return denied;`.
 */
export async function requireApiSession(): Promise<NextResponse | null> {
  const result = await resolveApiSession();

  return "denied" in result ? result.denied : null;
}

/**
 * Gate a route handler on a session that holds one of the given roles.
 * Returns null when the caller may proceed, or the 401/403 response to return as-is.
 *
 * The ordering is the security property, and it is now structural rather than a
 * convention: there is exactly one session read, and its 401 branch returns
 * before the role is ever read. A caller with no session can only ever receive
 * 401; a 403 to an anonymous caller would confirm the route exists and what it
 * protects, which is the classic broken-access-control leak.
 */
export async function requireApiRole(
  roles: Role[]
): Promise<NextResponse | null> {
  const result = await resolveApiSession();

  if ("denied" in result) return result.denied;

  const role = result.session.user.role;

  if (!role || !roles.includes(role as Role)) {
    // The role only, never a user id, email, cookie, or header.
    console.warn(`[Auth] Rejected session with role ${role ?? "(none)"}`);

    return NextResponse.json(
      { success: false, error: "Forbidden." },
      { status: 403 }
    );
  }

  return null;
}
