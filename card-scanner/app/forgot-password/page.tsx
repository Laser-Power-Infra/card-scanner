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
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-6">

      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border">

        {/* Header */}

        <div className="border-b p-8 text-center">

          <h1 className="text-3xl font-bold text-slate-800">
            Forgot Password
          </h1>

          <p className="text-gray-500 mt-2">
            Enter your email to receive a password reset link.
          </p>

        </div>

        {/* Form */}

        <form
          onSubmit={handleSubmit}
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

          {/* Email */}

          <div>

            <label className="block text-sm font-medium mb-2">
              Email Address
            </label>

            <div className="relative">

              <Mail
                size={18}
                className="absolute left-3 top-3.5 text-gray-400"
              />

              <input
                type="email"
                required
                placeholder="john@example.com"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                className="w-full border rounded-lg py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-sky-500"
              />

            </div>

          </div>

          {/* Submit */}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
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
                Send Reset Link
              </>
            )}

          </button>

          {/* Back */}

          <div className="text-center">

            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-sky-600 hover:underline"
            >
              <ArrowLeft size={16} />
              Back to Login
            </Link>

          </div>

        </form>

      </div>

    </div>
  );
}