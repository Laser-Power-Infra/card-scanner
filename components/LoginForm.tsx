"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
} from "lucide-react";

export default function LoginForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  async function handleSubmit(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    setError("");

    if (!email || !password) {
      setError("Please fill all fields.");
      return;
    }

    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
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
    <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl border">

      {/* Header */}

      <div className="border-b p-8 text-center">

        <h1 className="text-3xl font-bold text-slate-800">
          Login
        </h1>

        <p className="text-gray-500 mt-2">
          Welcome back to Card Scanner
        </p>

      </div>

      {/* Form */}

      <form
        onSubmit={handleSubmit}
        className="p-8 space-y-6"
      >

        {error && (
          <div className="bg-red-100 border border-red-300 text-red-700 rounded-lg p-3 text-sm">
            {error}
          </div>
        )}

        {/* Email */}

        <div>

          <label className="block text-sm font-medium mb-2">
            Email
          </label>

          <div className="relative">

            <Mail
              size={18}
              className="absolute left-3 top-3.5 text-gray-400"
            />

            <input
              type="email"
              required
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
              placeholder="john@example.com"
              className="w-full border rounded-lg py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-sky-500"
            />

          </div>

        </div>

        {/* Password */}

        <div>

          <label className="block text-sm font-medium mb-2">
            Password
          </label>

          <div className="relative">

            <Lock
              size={18}
              className="absolute left-3 top-3.5 text-gray-400"
            />

            <input
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              required
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              placeholder="Enter password"
              className="w-full border rounded-lg py-3 pl-10 pr-12 outline-none focus:ring-2 focus:ring-sky-500"
            />

            <button
              type="button"
              onClick={() =>
                setShowPassword(!showPassword)
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

        <div className="text-right">

          <Link
            href="/forgot-password"
            className="text-sky-600 hover:underline text-sm"
          >
            Forgot Password?
          </Link>

        </div>

        {/* Login Button */}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-3 flex items-center justify-center gap-2 disabled:opacity-60"
        >

          {loading ? (
            <>
              <Loader2
                size={18}
                className="animate-spin"
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

        <div className="text-center text-sm">

          Don't have an account?

          <Link
            href="/register"
            className="ml-2 text-sky-600 hover:underline font-medium"
          >
            Register
          </Link>

        </div>

      </form>

    </div>
  );
}