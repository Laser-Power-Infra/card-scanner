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
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-6">

      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border">

        {/* Header */}

        <div className="border-b p-8 text-center">

          <h1 className="text-3xl font-bold text-slate-800">
            Reset Password
          </h1>

          <p className="text-slate-500 mt-2">
            Create your new password
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

            <div className="bg-green-100 border border-green-300 rounded-lg p-3 text-green-700 flex items-center gap-2">

              <CheckCircle size={18} />

              {success}

            </div>

          )}

          {/* Password */}

          <div>

            <label className="block text-sm font-medium mb-2">

              New Password

            </label>

            <div className="relative">

              <Lock
                className="absolute left-3 top-3.5 text-gray-400"
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

          {/* Confirm Password */}

          <div>

            <label className="block text-sm font-medium mb-2">

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
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) =>
                  setConfirmPassword(e.target.value)
                }
                className="w-full border rounded-lg py-3 pl-10 pr-12 outline-none focus:ring-2 focus:ring-sky-500"
              />

              <button
                type="button"
                onClick={() =>
                  setShowConfirmPassword(
                    !showConfirmPassword
                  )
                }
                className="absolute right-3 top-3"
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
            className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
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
                Reset Password
              </>
            )}

          </button>

          {/* Login */}

          <div className="text-center">

            <Link
              href="/login"
              className="text-sky-600 hover:underline"
            >
              Back to Login
            </Link>

          </div>

        </form>

      </div>

    </div>
  );
}