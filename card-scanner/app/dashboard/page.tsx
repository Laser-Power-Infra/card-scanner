"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  ScanLine,
  CreditCard,
  Users,
  Building2,
  User,
  LogOut,
  FolderOpen,
  PlusCircle,
  Activity,
  ArrowRight,
} from "lucide-react";

export default function DashboardPage() {
  const { data: session } = useSession();

  const stats = [
    {
      title: "Business Cards",
      value: "0",
      icon: CreditCard,
      color: "bg-blue-500",
    },
    {
      title: "Companies",
      value: "0",
      icon: Building2,
      color: "bg-green-500",
    },
    {
      title: "Profiles",
      value: "0",
      icon: Users,
      color: "bg-sky-600",
    },
    {
      title: "Scans",
      value: "0",
      icon: ScanLine,
      color: "bg-orange-500",
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100">

      {/* Navbar */}

      <header className="bg-white border-b shadow-sm">

        <div className="max-w-7xl mx-auto flex justify-between items-center px-6 py-4">

          <div>

            <h1 className="text-2xl font-bold text-sky-600">
              Card Scanner
            </h1>

            <p className="text-sm text-gray-500">
              Dashboard
            </p>

          </div>

          <div className="flex items-center gap-4">

            <div className="flex items-center gap-2">

              <User size={20} />

              <span className="font-medium">
                {session?.user?.name || "Guest"}
              </span>

            </div>

            <button
              onClick={() => signOut()}
              className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg"
            >
              <LogOut size={18} />
              Logout
            </button>

          </div>

        </div>

      </header>

      <main className="max-w-7xl mx-auto p-8">

        {/* Welcome */}

        <div className="rounded-2xl bg-gradient-to-r from-sky-600 to-blue-600 p-8 text-white mb-8">

          <h2 className="text-3xl font-bold">
            Welcome,
            {" "}
            {session?.user?.name || "User"}
          </h2>

          <p className="mt-2 text-sky-100">
            Manage your business cards, profiles and company directory.
          </p>

        </div>

        {/* Statistics */}

        <div className="grid gap-6 md:grid-cols-4 mb-10">

          {stats.map((item) => (
            <div
              key={item.title}
              className="bg-white rounded-xl shadow p-6"
            >

              <div className="flex justify-between">

                <div>

                  <p className="text-gray-500 text-sm">
                    {item.title}
                  </p>

                  <h3 className="text-3xl font-bold mt-2">
                    {item.value}
                  </h3>

                </div>

                <div
                  className={`${item.color} h-12 w-12 rounded-xl flex items-center justify-center text-white`}
                >
                  <item.icon size={24} />
                </div>

              </div>

            </div>
          ))}

        </div>

        {/* Quick Actions */}

        <div className="grid md:grid-cols-4 gap-6 mb-10">

          <Link
            href="/"
            className="bg-white rounded-xl shadow p-6 hover:shadow-lg transition"
          >
            <ScanLine
              className="text-sky-600 mb-4"
              size={34}
            />

            <h3 className="font-semibold text-lg">
              Scan Card
            </h3>

            <p className="text-gray-500 mt-2 text-sm">
              Scan a new business card.
            </p>

          </Link>

          <Link
            href="/directory"
            className="bg-white rounded-xl shadow p-6 hover:shadow-lg transition"
          >
            <FolderOpen
              className="text-green-600 mb-4"
              size={34}
            />

            <h3 className="font-semibold text-lg">
              Card Directory
            </h3>

            <p className="text-gray-500 mt-2 text-sm">
              View all saved cards.
            </p>

          </Link>

          <Link
            href="/profile"
            className="bg-white rounded-xl shadow p-6 hover:shadow-lg transition"
          >
            <User
              className="text-sky-600 mb-4"
              size={34}
            />

            <h3 className="font-semibold text-lg">
              My Profile
            </h3>

            <p className="text-gray-500 mt-2 text-sm">
              Update your account.
            </p>

          </Link>

          <Link
            href="/cards/new"
            className="bg-white rounded-xl shadow p-6 hover:shadow-lg transition"
          >
            <PlusCircle
              className="text-orange-500 mb-4"
              size={34}
            />

            <h3 className="font-semibold text-lg">
              Add Card
            </h3>

            <p className="text-gray-500 mt-2 text-sm">
              Create a card manually.
            </p>

          </Link>

        </div>

        {/* Recent Cards */}

        <div className="bg-white rounded-xl shadow p-6 mb-10">

          <div className="flex justify-between items-center mb-6">

            <h2 className="text-xl font-bold">
              Recently Scanned Cards
            </h2>

            <Link
              href="/directory"
              className="flex items-center gap-2 text-sky-600"
            >
              View All
              <ArrowRight size={18} />
            </Link>

          </div>

          <div className="border rounded-lg p-8 text-center text-gray-500">

            No business cards scanned yet.

          </div>

        </div>

        {/* Activity */}

        <div className="bg-white rounded-xl shadow p-6">

          <div className="flex items-center gap-2 mb-6">

            <Activity
              className="text-sky-600"
              size={22}
            />

            <h2 className="text-xl font-bold">
              Recent Activity
            </h2>

          </div>

          <ul className="space-y-4 text-gray-600">

            <li>• Login successful.</li>

            <li>• Ready to scan your first business card.</li>

          </ul>

        </div>

      </main>

    </div>
  );
}