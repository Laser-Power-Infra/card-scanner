"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Menu, X, LogOut } from "lucide-react";

export default function Navbar() {
  const { data: session } = useSession();

  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = session?.user?.role === "ADMIN";

  return (
    <nav className="bg-white shadow border-b sticky top-0 z-50">
      <div className="max-w-7xl mx-auto h-16 px-6 flex items-center justify-between">

        {/* Logo */}

        <Link
          href="/dashboard"
          className="text-2xl font-bold text-sky-600"
        >
          Card Scanner
        </Link>

        {/* Desktop Menu */}

        <div className="hidden md:flex items-center gap-6">

          {session && (
            <>
              <Link
                href="/dashboard"
                className="hover:text-sky-600"
              >
                Dashboard
              </Link>

              <Link
                href="/directory"
                className="hover:text-sky-600"
              >
                Directory
              </Link>

              {isAdmin && (
                <Link
                  href="/admin"
                  className="hover:text-sky-600"
                >
                  Admin
                </Link>
              )}
            </>
          )}

        </div>

        {/* Right Side */}

        <div className="hidden md:flex items-center gap-4">

          {!session ? (
            <>
              <Link
                href="/login"
                className="text-gray-700 hover:text-sky-600"
              >
                Login
              </Link>

              <Link
                href="/register"
                className="bg-sky-600 text-white px-4 py-2 rounded-lg hover:bg-sky-700"
              >
                Register
              </Link>
            </>
          ) : (
            <>
              {/* Avatar */}

              {session.user.image ? (
                <Image
                  src={session.user.image}
                  alt="Profile"
                  width={40}
                  height={40}
                  className="rounded-full"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-sky-600 text-white flex items-center justify-center font-semibold">
                  {session.user.name?.charAt(0).toUpperCase()}
                </div>
              )}

              {/* User Info */}

              <div className="text-right">

                <p className="font-semibold">
                  {session.user.name}
                </p>

                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    isAdmin
                      ? "bg-red-100 text-red-600"
                      : "bg-green-100 text-green-600"
                  }`}
                >
                  {session.user.role}
                </span>

              </div>

              <button
                onClick={() =>
                  signOut({
                    callbackUrl: "/login",
                  })
                }
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg"
              >
                <LogOut size={18} />
                Logout
              </button>
            </>
          )}

        </div>

        {/* Mobile Button */}

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden"
        >
          {mobileOpen ? (
            <X size={28} />
          ) : (
            <Menu size={28} />
          )}
        </button>

      </div>

      {/* Mobile Menu */}

      {mobileOpen && (
        <div className="md:hidden border-t bg-white">

          <div className="flex flex-col p-4 gap-4">

            {!session ? (
              <>
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                >
                  Login
                </Link>

                <Link
                  href="/register"
                  onClick={() => setMobileOpen(false)}
                >
                  Register
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/dashboard"
                  onClick={() => setMobileOpen(false)}
                >
                  Dashboard
                </Link>

                <Link
                  href="/directory"
                  onClick={() => setMobileOpen(false)}
                >
                  Directory
                </Link>

                {isAdmin && (
                  <Link
                    href="/admin"
                    onClick={() => setMobileOpen(false)}
                  >
                    Admin
                  </Link>
                )}

                <button
                  onClick={() =>
                    signOut({
                      callbackUrl: "/login",
                    })
                  }
                  className="text-left text-red-600"
                >
                  Logout
                </button>
              </>
            )}

          </div>

        </div>
      )}
    </nav>
  );
}