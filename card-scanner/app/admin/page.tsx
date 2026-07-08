"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  Users,
  CreditCard,
  Building2,
  Activity,
  Shield,
  LogOut,
  Settings,
  Database,
  UserCog,
  Search,
  ArrowRight,
  FileText,
  LayoutDashboard,
} from "lucide-react";

export default function AdminPage() {
  const { data: session } = useSession();

  const stats = [
    {
      title: "Registered Users",
      value: "0",
      icon: Users,
      color: "bg-blue-500",
    },
    {
      title: "Business Cards",
      value: "0",
      icon: CreditCard,
      color: "bg-green-500",
    },
    {
      title: "Companies",
      value: "0",
      icon: Building2,
      color: "bg-sky-600",
    },
    {
      title: "Profile Searches",
      value: "0",
      icon: Search,
      color: "bg-orange-500",
    },
  ];

  const modules = [
    {
      title: "Manage Users",
      description: "View, edit and delete users.",
      href: "/admin/users",
      icon: Users,
    },
    {
      title: "Business Cards",
      description: "Manage scanned cards.",
      href: "/directory",
      icon: CreditCard,
    },
    {
      title: "Companies",
      description: "Manage company database.",
      href: "/admin/companies",
      icon: Building2,
    },
    {
      title: "Analytics",
      description: "View application analytics.",
      href: "/admin/analytics",
      icon: Activity,
    },
    {
      title: "Roles & Permissions",
      description: "Manage authorization.",
      href: "/admin/roles",
      icon: Shield,
    },
    {
      title: "System Settings",
      description: "Application configuration.",
      href: "/admin/settings",
      icon: Settings,
    },
    {
      title: "Database",
      description: "Database management.",
      href: "/admin/database",
      icon: Database,
    },
    {
      title: "Reports",
      description: "Generate reports.",
      href: "/admin/reports",
      icon: FileText,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100">

      {/* Header */}

      <header className="bg-white shadow border-b">

        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">

          <div className="flex items-center gap-3">

            <LayoutDashboard className="text-sky-600" size={30} />

            <div>

              <h1 className="text-2xl font-bold">
                Admin Dashboard
              </h1>

              <p className="text-sm text-gray-500">
                Business Card Scanner Administration
              </p>

            </div>

          </div>

          <div className="flex items-center gap-4">

            <div className="flex items-center gap-2">

              <UserCog size={20} />

              <span>
                {session?.user?.name || "Administrator"}
              </span>

            </div>

            <button
              onClick={() => signOut()}
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"
            >
              <LogOut size={18} />
              Logout
            </button>

          </div>

        </div>

      </header>

      <main className="max-w-7xl mx-auto p-8">

        {/* Welcome */}

        <div className="bg-gradient-to-r from-sky-700 to-blue-600 rounded-2xl p-8 text-white mb-10">

          <h2 className="text-4xl font-bold">
            Welcome Admin
          </h2>

          <p className="mt-2 text-sky-100">
            Manage users, cards, companies and application settings.
          </p>

        </div>

        {/* Statistics */}

        <div className="grid md:grid-cols-4 gap-6 mb-10">

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

        {/* Modules */}

        <h2 className="text-2xl font-bold mb-6">
          Administration
        </h2>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">

          {modules.map((module) => (

            <Link
              key={module.title}
              href={module.href}
              className="bg-white rounded-xl shadow hover:shadow-xl transition p-6"
            >

              <module.icon
                className="text-sky-600 mb-4"
                size={34}
              />

              <h3 className="font-bold text-lg">
                {module.title}
              </h3>

              <p className="text-gray-500 text-sm mt-2">
                {module.description}
              </p>

              <div className="mt-5 flex items-center gap-2 text-sky-600 font-medium">

                Open

                <ArrowRight size={18} />

              </div>

            </Link>

          ))}

        </div>

        {/* Recent Activity */}

        <div className="bg-white rounded-xl shadow mt-10 p-6">

          <h2 className="text-2xl font-bold mb-5">
            Recent Activity
          </h2>

          <div className="space-y-3">

            <div className="border rounded-lg p-4">
              System initialized successfully.
            </div>

            <div className="border rounded-lg p-4">
              Waiting for business cards.
            </div>

            <div className="border rounded-lg p-4">
              Waiting for user registrations.
            </div>

          </div>

        </div>

      </main>

    </div>
  );
}