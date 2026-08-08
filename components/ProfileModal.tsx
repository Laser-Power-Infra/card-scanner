"use client";

import { useEffect, useState } from "react";
import type { CardData, EnrichedProfile } from "@/types/card";

interface Props {
  contact: CardData | null;
  open: boolean;
  onClose: () => void;
}

function renderProfileField(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function ProfileModal({
  contact,
  open,
  onClose,
}: Props) {
  const [profile, setProfile] = useState<EnrichedProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !contact) return;

    // Start enrichment in background but keep previous profile until new arrives
    setError(null);
    setLoading(true);

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/profile/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(contact),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to fetch profile details.");
        }

        const data = await res.json();

        if (cancelled) return;

        setProfile(data.data ?? null);
      } catch (err) {
        if (!cancelled) setError((err as Error)?.message || "Unable to fetch profile details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, contact]);

  if (!open || !contact) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* overlay left side to close */}
      <div
        className="flex-1 bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      {/* Slide-over panel on right */}
      <aside className="w-full max-w-xl bg-white shadow-xl">
        <div className="h-full flex flex-col overflow-y-auto p-6 text-slate-900">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">{contact.fullName}</h2>
              <p className="text-sm text-slate-600">{contact.company}</p>
            </div>

            <div>
              <button onClick={onClose} className="text-slate-700 hover:text-slate-900">Close</button>
            </div>
          </div>

          <div className="mt-4 space-y-6">
            {/* Immediate contact details from card */}
            <section className="grid gap-4 sm:grid-cols-[80px_minmax(0,1fr)] items-start">
              {contact.fullName ? (
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-2xl font-semibold text-slate-700">
                  {contact.fullName
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
              ) : (
                <div className="h-20 w-20 rounded-full border border-slate-200 bg-slate-100" />
              )}

              <div className="space-y-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Mobile</p>
                  <p className="text-sm text-slate-700">{contact.mobileNumbers?.[0] ?? "-"}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Email</p>
                  <p className="text-sm text-slate-700">{contact.emails?.[0] ?? "-"}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Website</p>
                  <p className="text-sm text-slate-700">{contact.website ?? "-"}</p>
                </div>
              </div>
            </section>

            {/* Enrichment area: show immediately with contact info, update when profile arrives */}
            <section>
              {loading && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-600">Enriching profile…</div>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
              )}

              {profile && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Location</p>
                    <p className="text-base text-slate-700">{profile.location ?? "Not available"}</p>
                  </div>

                  <div>
                    <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Official site</p>
                    {profile.officialSite ? (
                      <a href={profile.officialSite} target="_blank" rel="noreferrer" className="text-sky-600 hover:text-sky-800">{profile.officialSite.replace(/^https?:\/\//, "")}</a>
                    ) : (
                      <p className="text-slate-700">Not found</p>
                    )}
                  </div>

                  <div>
                    <p className="text-sm uppercase tracking-[0.2em] text-slate-500">LinkedIn</p>
                    {profile.linkedinProfile ? (
                      <a href={profile.linkedinProfile} target="_blank" rel="noreferrer" className="text-sky-600 hover:text-sky-800">{profile.linkedinProfile}</a>
                    ) : (
                      <p className="text-slate-700">Not available</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="font-semibold text-slate-900">Summary</h3>
                    <p className="mt-2 text-slate-700">{renderProfileField(profile.summary) ?? "No summary available."}</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 p-4">
                      <h3 className="font-semibold text-slate-900">Company Details</h3>
                      <p className="mt-2 text-slate-700">{renderProfileField(profile.companyDetails) ?? "Not available."}</p>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">
                      <h3 className="font-semibold text-slate-900">Career Background</h3>
                      <p className="mt-2 text-slate-700">{renderProfileField(profile.careerBackground) ?? "Not available."}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <h3 className="font-semibold text-slate-900">Other Profiles</h3>
                    {profile.socialProfiles && profile.socialProfiles.length > 0 ? (
                      <ul className="mt-3 space-y-2 text-slate-700">
                        {profile.socialProfiles.map((social) => (
                          <li key={social.url}>
                            <a href={social.url} target="_blank" rel="noreferrer" className="text-sky-600 hover:text-sky-800">{social.label}: {social.url.replace(/^https?:\/\//, "")}</a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-slate-700">No other social profiles found.</p>
                    )}
                  </div>
                </div>
              )}

              {!loading && !profile && !error && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-700">No extra profile details were found.</div>
              )}
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}