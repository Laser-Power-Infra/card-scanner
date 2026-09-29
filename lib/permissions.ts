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