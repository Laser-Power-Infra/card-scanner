"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Menu, X, LogOut } from "lucide-react";

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = session?.user?.role === "ADMIN";

  const linkClass = (href: string) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition duration-200 ease-spring ${
      pathname === href
        ? "bg-stone-900/5 text-ink"
        : "text-stone-600 hover:bg-stone-900/5 hover:text-ink"
    }`;

  return (
    <nav className="sticky top-0 z-50 border-b border-stone-200/80 bg-paper/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 items-center justify-between px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-700 shadow-soft transition duration-200 ease-spring group-hover:-rotate-3">
            <span className="h-3.5 w-5 rounded-[3px] border-2 border-paper" />
          </span>
          <span className="font-display text-xl font-medium tracking-tight text-ink">
            Cardfile
          </span>
        </Link>

        {/* Desktop */}
        <div className="hidden items-center gap-3 md:flex">
          {!session ? (
            <>
              <Link href="/login" className={linkClass("/login")}>
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 active:scale-[.98]"
              >
                Create account
              </Link>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-xl py-1 pl-1 pr-3">
                {session.user.image ? (
                  <Image
                    src={session.user.image}
                    alt=""
                    width={34}
                    height={34}
                    className="rounded-[10px]"
                  />
                ) : (
                  <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-accent-100 text-sm font-semibold text-accent-800">
                    {session.user.name?.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="leading-tight">
                  <p className="text-sm font-medium text-ink">{session.user.name}</p>
                  <p className={`text-xs ${isAdmin ? "text-accent-700" : "text-stone-500"}`}>
                    {isAdmin ? "Admin" : "Member"}
                  </p>
                </div>
              </div>

              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 transition duration-200 ease-spring hover:bg-stone-900/5 hover:text-ink active:scale-[.98]"
              >
                <LogOut size={16} strokeWidth={1.75} />
                Log out
              </button>
            </>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          className="rounded-lg p-2 text-ink transition hover:bg-stone-900/5 md:hidden"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="animate-rise border-t border-stone-200 bg-paper md:hidden">
          <div className="flex flex-col gap-1 p-4">
            {!session ? (
              <>
                <Link href="/login" onClick={() => setMobileOpen(false)} className={linkClass("/login")}>
                  Log in
                </Link>
                <Link href="/register" onClick={() => setMobileOpen(false)} className={linkClass("/register")}>
                  Create account
                </Link>
              </>
            ) : (
              <>
                <p className="px-3 py-1.5 text-sm text-stone-500">
                  Signed in as <span className="font-medium text-ink">{session.user.name}</span>
                </p>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="rounded-lg px-3 py-1.5 text-left text-sm font-medium text-red-700 transition hover:bg-red-50"
                >
                  Log out
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
