"use client";

import { FormEvent, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

import {
  Lock,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle,
} from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();

  const params = useParams();

  const token = params.token as string;

  const [password, setPassword] = useState("");

  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [success, setSuccess] = useState("");

  async function handleSubmit(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (!password || !confirmPassword) {
      setError("Please fill all fields.");
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
      const response = await fetch(
        "/api/auth/reset-password",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            token,
            password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to reset password.");
        setLoading(false);
        return;
      }

      setSuccess("Password reset successful.");

      setTimeout(() => {
        router.push("/login");
      }, 2000);

    } catch (err) {

      console.error(err);

      setError("Something went wrong.");

    }

    setLoading(false);
  }

  return (
    <div id="main" className="bg-grain min-h-[calc(100dvh-64px)] flex items-center justify-center px-4 py-12">

      <div className="w-full max-w-md animate-rise bg-white rounded-2xl shadow-lift ring-1 ring-stone-900/[0.04]">

        {/* Header */}

        <div className="px-8 pt-10 pb-2 text-center">

          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Reset password
          </h1>

          <p className="mt-2 text-sm text-stone-500">
            Create your new password
          </p>

        </div>

        {/* Form */}

        <form
          onSubmit={handleSubmit}
          className="px-8 pt-6 pb-10 space-y-5"
        >

          {error && (

            <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">

              {error}

            </div>

          )}

          {success && (

            <div role="status" className="rounded-xl bg-accent-50 p-3 text-accent-800 ring-1 ring-accent-200 flex items-center gap-2">

              <CheckCircle size={18} />

              {success}

            </div>

          )}

          {/* Password */}

          <div>

            <label className="block text-sm font-medium text-ink mb-2">

              New password

            </label>

            <div className="relative">

              <Lock
                className="absolute left-3 top-3.5 text-stone-400"
                size={18}
              />

              <input
                type={showPassword ? "text" : "password"}
                required
                placeholder="Enter new password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                className="w-full rounded-xl border border-stone-200 bg-white py-3 text-ink placeholder:text-stone-400 transition duration-200 pl-10 pr-12 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(!showPassword)
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

          {/* Confirm Password */}

          <div>

            <label className="block text-sm font-medium text-ink mb-2">

              Confirm password

            </label>

            <div className="relative">

              <Lock
                className="absolute left-3 top-3.5 text-stone-400"
                size={18}
              />

              <input
                type={
                  showConfirmPassword
                    ? "text"
                    : "password"
                }
                required
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) =>
                  setConfirmPassword(e.target.value)
                }
                className="w-full rounded-xl border border-stone-200 bg-white py-3 text-ink placeholder:text-stone-400 transition duration-200 pl-10 pr-12 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
              />

              <button
                type="button"
                onClick={() =>
                  setShowConfirmPassword(
                    !showConfirmPassword
                  )
                }
                className="absolute right-3 top-3 rounded-md text-stone-400 transition hover:text-ink"
              >

                {showConfirmPassword ? (
                  <EyeOff size={20} />
                ) : (
                  <Eye size={20} />
                )}

              </button>

            </div>

          </div>

          {/* Submit */}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-accent-700 py-3 font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 active:scale-[.98] disabled:hover:translate-y-0 flex items-center justify-center gap-2 disabled:opacity-60"
          >

            {loading ? (
              <>
                <Loader2
                  size={18}
                  className="animate-spin"
                />
                Updating...
              </>
            ) : (
              <>
                <CheckCircle size={18} />
                Reset password
              </>
            )}

          </button>

          {/* Login */}

          <div className="text-center">

            <Link
              href="/login"
              className="text-accent-700 hover:underline"
            >
              Back to log in
            </Link>

          </div>

        </form>

      </div>

    </div>
  );
}