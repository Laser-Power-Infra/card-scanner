"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, Eye, EyeOff, Loader2, CheckCircle, ArrowLeft } from "lucide-react";

export default function ForceResetPage() {
  const router = useRouter();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [defaultPassword, setDefaultPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (!newPassword || !confirmPassword || !defaultPassword) {
      setError("Please fill all fields.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (newPassword === defaultPassword) {
      setError("New password must be different from the default password.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/force-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, defaultPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to reset password.");
        setLoading(false);
        return;
      }

      setSuccess("Password reset successful.");

      setTimeout(() => {
        router.push("/");
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
        <div className="px-8 pt-10 pb-2 text-center">
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Set new password
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            You logged in with a temporary password. Choose a new one.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-8 pt-6 pb-10 space-y-5">
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

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Default password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3.5 text-stone-400" size={18} />
              <input
                type="text"
                required
                placeholder="Enter the default password you received"
                value={defaultPassword}
                onChange={(e) => setDefaultPassword(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white py-3 text-ink placeholder:text-stone-400 transition duration-200 pl-10 pr-4 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              New password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3.5 text-stone-400" size={18} />
              <input
                type={showPassword ? "text" : "password"}
                required
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white py-3 text-ink placeholder:text-stone-400 transition duration-200 pl-10 pr-12 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 rounded-md text-stone-400 transition hover:text-ink"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Confirm new password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3.5 text-stone-400" size={18} />
              <input
                type={showConfirmPassword ? "text" : "password"}
                required
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white py-3 text-ink placeholder:text-stone-400 transition duration-200 pl-10 pr-12 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-3 rounded-md text-stone-400 transition hover:text-ink"
              >
                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-accent-700 py-3 font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 active:scale-[.98] disabled:hover:translate-y-0 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <CheckCircle size={18} />
                Reset password
              </>
            )}
          </button>

          <div className="text-center">
            <Link href="/" className="inline-flex items-center gap-2 text-accent-700 hover:underline">
              <ArrowLeft size={16} />
              Back to home
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
