"use client";

import { ReactNode, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: ReactNode;
  redirectTo?: string;
}

export default function ProtectedRoute({
  children,
  redirectTo = "/login",
}: ProtectedRouteProps) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(redirectTo);
    }
  }, [status, router, redirectTo]);

  // Show loading spinner while checking session
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2
            className="h-10 w-10 animate-spin text-sky-600"
          />
          <p className="text-gray-600">
            Checking authentication...
          </p>
        </div>
      </div>
    );
  }

  // Prevent page flash before redirect
  if (!session) {
    return null;
  }

  return <>{children}</>;
}