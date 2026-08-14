"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import {
  researchAllContacts,
  type ResearchAllMode,
} from "@/app/actions/profile-collection";

export default function ResearchAllButton() {
  const { data: session } = useSession();
  const [mode, setMode] = useState<ResearchAllMode>("not_done");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session?.user || session.user.role !== "DEVELOPER") {
    return null;
  }

  const handleClick = async () => {
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const result = await researchAllContacts(mode);

      if (!result.success) {
        setError(result.error || "Failed to queue research tasks.");
      } else if (result.total === 0) {
        setMessage("No profiles found to queue.");
      } else {
        setMessage(
          `Queued ${result.queued} of ${result.total} profiles` +
            (result.failed > 0 ? ` (${result.failed} failed)` : "")
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to queue research tasks."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
        {(["all", "not_done"] as ResearchAllMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === m
                ? "bg-white text-sky-700 shadow"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {m === "all" ? "All" : "Not Done"}
          </button>
        ))}
      </div>

      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
      >
        {loading ? "Queuing…" : "Research All"}
      </button>

      {message && (
        <p className="text-sm text-slate-700">{message}</p>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
