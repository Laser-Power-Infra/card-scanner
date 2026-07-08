"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  Loader2,
  LogIn,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);

  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");

  async function handleLogin(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/dashboard",
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-6">

      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border">

        {/* Header */}

        <div className="p-8 border-b text-center">

          <h1 className="text-3xl font-bold text-slate-800">
            Welcome Back
          </h1>

          <p className="text-slate-500 mt-2">
            Login to your account
          </p>

        </div>

        {/* Form */}

        <form
          onSubmit={handleLogin}
          className="p-8 space-y-6"
        >

          {error && (

            <div className="bg-red-100 border border-red-300 text-red-700 rounded-lg p-3 text-sm">

              {error}

            </div>

          )}

          {/* Email */}

          <div>

            <label className="block text-sm font-medium text-slate-700">
              Email
            </label>

            <div className="relative mt-2">

              <Mail
                className="absolute left-3 top-3.5 text-gray-400"
                size={18}
              />

              <input
                type="email"
                required
                autoComplete="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                className="w-full border rounded-lg py-3 pl-10 pr-4 focus:ring-2 focus:ring-sky-500 outline-none"
              />

            </div>

          </div>

          {/* Password */}

          <div>

            <label className="block text-sm font-medium text-slate-700">
              Password
            </label>

            <div className="relative mt-2">

              <Lock
                className="absolute left-3 top-3.5 text-gray-400"
                size={18}
              />

              <input
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                required
                autoComplete="current-password"
                placeholder="********"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                className="w-full border rounded-lg py-3 pl-10 pr-12 focus:ring-2 focus:ring-sky-500 outline-none"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(
                    !showPassword
                  )
                }
                className="absolute right-3 top-3"
              >
                {showPassword ? (
                  <EyeOff size={20} />
                ) : (
                  <Eye size={20} />
                )}
              </button>

            </div>

          </div>

          {/* Forgot Password */}

          <div className="flex justify-end">

            <Link
              href="/forgot-password"
              className="text-sky-600 text-sm hover:underline"
            >
              Forgot Password?
            </Link>

          </div>

          {/* Login */}

          <button
            disabled={loading}
            className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-3 font-semibold flex justify-center items-center gap-2 disabled:opacity-60"
          >

            {loading ? (
              <>
                <Loader2
                  className="animate-spin"
                  size={18}
                />

                Signing In...
              </>
            ) : (
              <>
                <LogIn size={18} />

                Login
              </>
            )}

          </button>

          {/* Register */}

          <div className="text-center text-sm text-gray-500">

            Don't have an account?

            <Link
              href="/register"
              className="ml-2 text-sky-600 font-semibold hover:underline"
            >
              Register
            </Link>

          </div>

        </form>

      </div>

    </div>
  );
}