"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import type { ResearchAllMode } from "@/app/actions/profile-collection";
import { useAppDispatch, useAppSelector } from "@/lib/store";
import { researchAll } from "@/lib/store/contactsSlice";

export default function ResearchAllButton() {
  const { data: session } = useSession();
  const [mode, setMode] = useState<ResearchAllMode>("not_done");
  const dispatch = useAppDispatch();
  const { status, message, error } = useAppSelector((s) => s.contacts.research);
  const loading = status === "loading";

  if (!session?.user || session.user.role !== "DEVELOPER") {
    return null;
  }

  const handleClick = () => {
    dispatch(researchAll(mode));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 rounded-lg bg-stone-200/70 p-1">
        {(["all", "not_done"] as ResearchAllMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === m
                ? "bg-white text-ink shadow-soft"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            {m === "all" ? "All" : "Not done"}
          </button>
        ))}
      </div>

      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 active:scale-[.98] disabled:opacity-50"
      >
        {loading ? "Queuing…" : "Research all"}
      </button>

      {message && (
        <p className="text-sm text-stone-700">{message}</p>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
