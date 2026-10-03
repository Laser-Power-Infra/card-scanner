"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Mail, Loader2, Send, ArrowLeft, Copy, CheckCircle, Clock } from "lucide-react";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<"form" | "result">("form");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [defaultPassword, setDefaultPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Something went wrong.");
        setLoading(false);
        return;
      }

      if (data.defaultPassword) {
        setDefaultPassword(data.defaultPassword);
        setExpiresAt(data.expiresAt);
        setStep("result");
      } else {
        setError("No account found with those details.");
      }
    } catch (err) {
      console.error(err);
      setError("Server Error.");
    }

    setLoading(false);
  }

  async function handleConfirm() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/confirm-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: defaultPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Something went wrong.");
        setLoading(false);
        return;
      }

      window.location.href = "/login";
    } catch (err) {
      console.error(err);
      setError("Server Error.");
    }

    setLoading(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(defaultPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (step === "result") {
    return (
      <div id="main" className="bg-grain min-h-[calc(100dvh-64px)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md animate-rise bg-white rounded-2xl shadow-lift ring-1 ring-stone-900/[0.04]">
          <div className="px-8 pt-10 pb-2 text-center">
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Reset link generated
            </h1>
            <p className="mt-2 text-sm text-stone-500">
              Copy your default password and confirm to proceed.
            </p>
          </div>

          <div className="px-8 pt-6 pb-10 space-y-5">
            {error && (
              <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                Default password
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={defaultPassword}
                  className="flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 font-mono text-sm text-ink"
                />
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-stone-100 px-3 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-200 transition"
                >
                  {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            {expiresAt && (
              <div className="flex items-center gap-2 text-xs text-stone-500">
                <Clock size={14} />
                Expires at {new Date(expiresAt).toLocaleString()}
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={loading}
              className="w-full rounded-xl bg-accent-700 py-3 font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 active:scale-[.98] disabled:hover:translate-y-0 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Confirming...
                </>
              ) : (
                <>
                  <CheckCircle size={18} />
                  Confirm reset
                </>
              )}
            </button>

            <div className="text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-accent-700 hover:underline"
              >
                <ArrowLeft size={16} />
                Go to login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="main" className="bg-grain min-h-[calc(100dvh-64px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md animate-rise bg-white rounded-2xl shadow-lift ring-1 ring-stone-900/[0.04]">
        <div className="px-8 pt-10 pb-2 text-center">
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Forgot password
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Enter your email and name to receive a default password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-8 pt-6 pb-10 space-y-5">
          {error && (
            <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Email address
            </label>
            <div className="relative">
              <Mail size={18} className="absolute left-3 top-3.5 text-stone-400" />
              <input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white py-3 text-ink placeholder:text-stone-400 transition duration-200 pl-10 pr-4 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Full name
            </label>
            <input
              type="text"
              required
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-ink placeholder:text-stone-400 transition duration-200 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-accent-700 py-3 font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 active:scale-[.98] disabled:hover:translate-y-0 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send size={18} />
                Send reset link
              </>
            )}
          </button>

          <div className="text-center">
            <Link href="/login" className="inline-flex items-center gap-2 text-accent-700 hover:underline">
              <ArrowLeft size={16} />
              Back to log in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
