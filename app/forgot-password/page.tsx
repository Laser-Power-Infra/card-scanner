"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Mail, Loader2, Send, ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [success, setSuccess] = useState("");

  async function handleSubmit(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        "/api/auth/forgot-password",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            email,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Something went wrong.");
        setLoading(false);
        return;
      }

      setSuccess(
        "If an account exists with this email, a password reset link has been generated."
      );

      setEmail("");

    } catch (err) {
      console.error(err);

      setError("Server Error.");
    }

    setLoading(false);
  }

  return (
    <div id="main" className="bg-grain min-h-[calc(100dvh-64px)] flex items-center justify-center px-4 py-12">

      <div className="w-full max-w-md animate-rise bg-white rounded-2xl shadow-lift ring-1 ring-stone-900/[0.04]">

        {/* Header */}

        <div className="px-8 pt-10 pb-2 text-center">

          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Forgot password
          </h1>

          <p className="mt-2 text-sm text-stone-500">
            Enter your email to receive a password reset link.
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

            <div role="status" className="rounded-xl bg-accent-50 p-3 text-accent-800 ring-1 ring-accent-200 text-sm">

              {success}

            </div>

          )}

          {/* Email */}

          <div>

            <label className="block text-sm font-medium text-ink mb-2">
              Email address
            </label>

            <div className="relative">

              <Mail
                size={18}
                className="absolute left-3 top-3.5 text-stone-400"
              />

              <input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                className="w-full rounded-xl border border-stone-200 bg-white py-3 text-ink placeholder:text-stone-400 transition duration-200 pl-10 pr-4 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
              />

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
                Sending...
              </>
            ) : (
              <>
                <Send size={18} />
                Send reset link
              </>
            )}

          </button>

          {/* Back */}

          <div className="text-center">

            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-accent-700 hover:underline"
            >
              <ArrowLeft size={16} />
              Back to log in
            </Link>

          </div>

        </form>

      </div>

    </div>
  );
}