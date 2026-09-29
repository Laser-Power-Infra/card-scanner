import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export enum Role {
  USER = "USER",
  ADMIN = "ADMIN",
  DEVELOPER = "DEVELOPER",
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
 * Gate a route handler on an authenticated session.
 * Returns null when the caller may proceed, or the 401 response to return as-is.
 *
 * Deliberately not a throwing check like requireAuth: a route handler has to
 * return a response rather than propagate, so the handler becomes
 * `const denied = await requireApiSession(); if (denied) return denied;`.
 */
export async function requireApiSession(): Promise<NextResponse | null> {
  const session = await getCurrentSession();

  if (!session?.user) {
    // No URL, cookie, or header in this line: it must not become a leak vector.
    console.warn("[Auth] Rejected unauthenticated API request");

    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }

  return null;
}

/**
 * Gate a route handler on a session that holds one of the given roles.
 * Returns null when the caller may proceed, or the 401/403 response to return as-is.
 *
 * The ordering is the security property: requireApiSession() runs first and its
 * result is returned immediately, so a caller with no session can only ever
 * receive 401. A 403 to an anonymous caller would confirm the route exists and
 * what it protects, which is the classic broken-access-control leak. The role is
 * only evaluated once a session is confirmed.
 *
 * This costs a second getServerSession round trip on the role-gated path. Both
 * are local JWE decrypts of the same cookie, not database queries; collapsing
 * them would mean re-implementing the check requireApiSession already owns.
 */
export async function requireApiRole(
  roles: Role[]
): Promise<NextResponse | null> {
  const denied = await requireApiSession();

  if (denied) return denied;

  const session = await getCurrentSession();
  const role = session?.user?.role;

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