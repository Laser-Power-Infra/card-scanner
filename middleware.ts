import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Removed stub pages, and auth pages for logged-in users, all go home.
    if (
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/directory") ||
      pathname.startsWith("/admin") ||
      (token && (pathname === "/login" || pathname === "/register"))
    ) {
      return NextResponse.redirect(new URL("/", req.url));
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
    "/contacts/:path*",
    "/login",
    "/register",
  ],
};
