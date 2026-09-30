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
      callbackUrl: "/",
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div id="main" className="bg-grain min-h-[calc(100dvh-64px)] flex items-center justify-center px-4 py-12">

      <div className="w-full max-w-md animate-rise bg-white rounded-2xl shadow-lift ring-1 ring-stone-900/[0.04]">

        {/* Header */}

        <div className="px-8 pt-10 pb-2 text-center">

          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Welcome back
          </h1>

          <p className="mt-2 text-sm text-stone-500">
            Log in to your cardfile
          </p>

        </div>

        {/* Form */}

        <form
          onSubmit={handleLogin}
          className="px-8 pt-6 pb-10 space-y-5"
        >

          {error && (

            <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">

              {error}

            </div>

          )}

          {/* Email */}

          <div>

            <label className="block text-sm font-medium text-ink">
              Email
            </label>

            <div className="relative mt-2">

              <Mail
                className="absolute left-3 top-3.5 text-stone-400"
                size={18}
              />

              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                className="w-full rounded-xl border border-stone-200 bg-white py-3 text-ink placeholder:text-stone-400 transition duration-200 pl-10 pr-4 focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10 outline-none"
              />

            </div>

          </div>

          {/* Password */}

          <div>

            <label className="block text-sm font-medium text-ink">
              Password
            </label>

            <div className="relative mt-2">

              <Lock
                className="absolute left-3 top-3.5 text-stone-400"
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
                className="w-full rounded-xl border border-stone-200 bg-white py-3 text-ink placeholder:text-stone-400 transition duration-200 pl-10 pr-12 focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10 outline-none"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(
                    !showPassword
                  )
                }
                className="absolute right-3 top-3 rounded-md text-stone-400 transition hover:text-ink"
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
              className="text-accent-700 text-sm hover:underline"
            >
              Forgot Password?
            </Link>

          </div>

          {/* Login */}

          <button
            disabled={loading}
            className="w-full rounded-xl bg-accent-700 py-3 font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 active:scale-[.98] disabled:hover:translate-y-0 flex justify-center items-center gap-2 disabled:opacity-60"
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

          <div className="text-center text-sm text-stone-500">

            Don't have an account?

            <Link
              href="/register"
              className="ml-2 font-medium text-accent-700 hover:underline"
            >
              Register
            </Link>

          </div>

        </form>

      </div>

    </div>
  );
}