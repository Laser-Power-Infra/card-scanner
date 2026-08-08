"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  UserPlus,
} from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();

  const [name, setName] = useState("");

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [success, setSuccess] = useState("");

  async function handleRegister(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (
      !name ||
      !email ||
      !password ||
      !confirmPassword
    ) {
      setError("Please fill in all fields.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          name,
          email,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Registration failed.");
        setLoading(false);
        return;
      }

      setSuccess("Registration successful! Redirecting...");

      setTimeout(() => {
        router.push("/login");
      }, 1500);

    } catch (err) {
      console.error(err);

      setError("Something went wrong.");
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-6">

      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border">

        {/* Header */}

        <div className="border-b p-8 text-center">

          <h1 className="text-3xl font-bold text-slate-800">
            Create Account
          </h1>

          <p className="text-slate-500 mt-2">
            Register to use Card Scanner
          </p>

        </div>

        {/* Form */}

        <form
          onSubmit={handleRegister}
          className="p-8 space-y-6"
        >

          {error && (
            <div className="bg-red-100 border border-red-300 rounded-lg p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-100 border border-green-300 rounded-lg p-3 text-green-700 text-sm">
              {success}
            </div>
          )}

          {/* Name */}

          <div>

            <label className="block text-sm font-medium text-slate-700 mb-2">
              Full Name
            </label>

            <div className="relative">

              <User
                className="absolute left-3 top-3.5 text-gray-400"
                size={18}
              />

              <input
                type="text"
                required
                value={name}
                onChange={(e) =>
                  setName(e.target.value)
                }
                placeholder="John Doe"
                className="w-full border rounded-lg py-3 pl-10 pr-4 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-sky-500"
              />

            </div>

          </div>

          {/* Email */}

          <div>

            <label className="block text-sm font-medium text-slate-700 mb-2">
              Email
            </label>

            <div className="relative">

              <Mail
                className="absolute left-3 top-3.5 text-gray-400"
                size={18}
              />

              <input
                type="email"
                required
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                placeholder="john@example.com"
                className="w-full border rounded-lg py-3 pl-10 pr-4 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-sky-500"
              />

            </div>

          </div>

          {/* Password */}

          <div>

            <label className="block text-sm font-medium text-slate-700 mb-2">
              Password
            </label>

            <div className="relative">

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
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                placeholder="********"
                className="w-full border rounded-lg py-3 pl-10 pr-12 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-sky-500"
              />

              <button
                type="button"
                className="absolute right-3 top-3"
                onClick={() =>
                  setShowPassword(!showPassword)
                }
              >
                {showPassword ? (
                  <EyeOff size={20} />
                ) : (
                  <Eye size={20} />
                )}
              </button>

            </div>

          </div>

          {/* Confirm Password */}

          <div>

            <label className="block text-sm font-medium text-slate-700 mb-2">
              Confirm Password
            </label>

            <div className="relative">

              <Lock
                className="absolute left-3 top-3.5 text-gray-400"
                size={18}
              />

              <input
                type={
                  showConfirmPassword
                    ? "text"
                    : "password"
                }
                required
                value={confirmPassword}
                onChange={(e) =>
                  setConfirmPassword(
                    e.target.value
                  )
                }
                placeholder="********"
                className="w-full border rounded-lg py-3 pl-10 pr-12 text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-sky-500"
              />

              <button
                type="button"
                className="absolute right-3 top-3"
                onClick={() =>
                  setShowConfirmPassword(
                    !showConfirmPassword
                  )
                }
              >
                {showConfirmPassword ? (
                  <EyeOff size={20} />
                ) : (
                  <Eye size={20} />
                )}
              </button>

            </div>

          </div>

          {/* Register */}

          <button
            disabled={loading}
            className="w-full bg-sky-600 hover:bg-sky-700 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >

            {loading ? (
              <>
                <Loader2
                  size={18}
                  className="animate-spin"
                />
                Creating Account...
              </>
            ) : (
              <>
                <UserPlus size={18} />
                Register
              </>
            )}

          </button>

          {/* Login */}

          <div className="text-center text-sm">

            Already have an account?

            <Link
              href="/login"
              className="ml-2 text-sky-600 font-semibold hover:underline"
            >
              Login
            </Link>

          </div>

        </form>

      </div>

    </div>
  );
}