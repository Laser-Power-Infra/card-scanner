import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Force reset redirect: if user has mustResetPassword, only allow
    // /force-reset and /api/auth/force-reset through.
    if (
      token?.mustResetPassword &&
      pathname !== "/force-reset" &&
      !pathname.startsWith("/api/auth/force-reset")
    ) {
      return NextResponse.redirect(new URL("/force-reset", req.url));
    }

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
          pathname === "/force-reset" ||
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
  // `/contacts/:path*` is deliberately absent. The contact profile page is a
  // public-by-decision surface like `/`; it reads the session in order to hide
  // the enrichment sections, not to redirect. The `authorized` callback above is
  // not consulted for paths outside this matcher.
  matcher: [
    "/dashboard/:path*",
    "/directory/:path*",
    "/admin/:path*",
    "/login",
    "/register",
  ],
};
