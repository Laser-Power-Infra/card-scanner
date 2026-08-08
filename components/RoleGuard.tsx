"use client";

import { ReactNode } from "react";
import { useSession } from "next-auth/react";

interface RoleGuardProps {
  children: ReactNode;
  allowedRoles?: ("USER" | "ADMIN")[];
  fallback?: ReactNode;
}

export default function RoleGuard({
  children,
  allowedRoles = ["USER", "ADMIN"],
  fallback,
}: RoleGuardProps) {
  const { data: session, status } = useSession();

  // Loading session
  if (status === "loading") {
    return (
      <div className="flex justify-center items-center min-h-[300px]">
        <div className="text-lg font-medium animate-pulse">
          Loading...
        </div>
      </div>
    );
  }

  // Not logged in
  if (!session) {
    return (
      fallback ?? (
        <div className="flex justify-center items-center min-h-[300px]">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <h2 className="text-xl font-bold text-red-600">
              Unauthorized
            </h2>

            <p className="mt-2 text-gray-600">
              Please login to continue.
            </p>
          </div>
        </div>
      )
    );
  }

  // Role not allowed
  if (!allowedRoles.includes(session.user.role)) {
    return (
      fallback ?? (
        <div className="flex justify-center items-center min-h-[300px]">
          <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-6 text-center">
            <h2 className="text-xl font-bold text-yellow-700">
              Access Denied
            </h2>

            <p className="mt-2 text-gray-700">
              You don't have permission to access this page.
            </p>
          </div>
        </div>
      )
    );
  }

  return <>{children}</>;
}