import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Protect Admin Routes
    if (
      pathname.startsWith("/admin") &&
      token?.role !== "ADMIN"
    ) {
      return NextResponse.redirect(
        new URL("/dashboard", req.url)
      );
    }

    // Redirect logged-in users away from auth pages
    if (
      token &&
      (pathname === "/login" ||
        pathname === "/register")
    ) {
      return NextResponse.redirect(
        new URL("/dashboard", req.url)
      );
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;

        // Public Routes
        if (
          pathname === "/" ||
          pathname === "/login" ||
          pathname === "/register" ||
          pathname.startsWith("/forgot-password") ||
          pathname.startsWith("/reset-password") ||
          pathname.startsWith("/api/auth")
        ) {
          return true;
        }

        // Everything else requires login
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/directory/:path*",
    "/admin/:path*",
    "/login",
    "/register",
  ],
};