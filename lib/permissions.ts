import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export enum Role {
  USER = "USER",
  ADMIN = "ADMIN",
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