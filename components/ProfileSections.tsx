// Profile sections shared by the slide-over drawer (client) and the full
// /contacts/[id] page (server). Presentational only: no hooks and no data
// fetching, so either side can render them.

import { ExternalLink, MapPin } from "lucide-react";

import { CopyButton } from "@/app/contacts/[id]/ProfileActions";
import type { CompanyLocationDetail, LocationPrecision, LocationSource } from "@/types/card";

const PRECISION_LABEL: Record<LocationPrecision, string> = {
  STREET: "Street-level",
  AREA: "Area",
  CITY: "City centre",
};

const SOURCE_LABEL: Record<LocationSource, string> = {
  OWN_SITE: "Company website",
  REGISTRY: "Registry",
  DIRECTORY: "Directory",
  MIGRATED: "Imported",
};

/**
 * `url` only if it is a plain http(s) link. Source URLs are scraped from the
 * web, so anything else (`javascript:`, `data:`) must never become an href.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The address as display lines: street, "City, State PIN", country. */
export function locationAddressLines(l: CompanyLocationDetail): string[] {
  const cityState = [l.city, l.state].map((p) => p?.trim()).filter(Boolean).join(", ");
  const cityLine = [cityState, l.postal_code?.trim()].filter(Boolean).join(" ");
  return [l.address_line1, l.address_line2, cityLine, l.country]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p);
}

/**
 * A Maps link. Coordinates only when the pin is street-level: an area or city
 * pin is a centroid, so searching by the address text is the honest link.
 */
export function mapsHref(l: CompanyLocationDetail): string {
  const query =
    l.precision === "STREET" && l.latitude != null && l.longitude != null
      ? `${l.latitude},${l.longitude}`
      : locationAddressLines(l).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The contact's worker-found offices. `canSeeSources` is the caller's gate for
 * provenance; the data is withheld from an anonymous read by the query, so the
 * flag only decides whether to draw what is there.
 */
export function LocationsList({
  locations,
  canSeeSources = false,
  verifiedAt = null,
}: {
  locations: CompanyLocationDetail[];
  canSeeSources?: boolean;
  /** When the primary address was verified (signed-in only). */
  verifiedAt?: string | null;
}) {
  return (
    <ul className="space-y-3">
      {locations.map((l) => {
        const lines = locationAddressLines(l);
        const sourceUrl = canSeeSources ? safeHttpUrl(l.source_url) : null;
        const moreSources = canSeeSources ? Math.max((l.source_urls?.length ?? 0) - 1, 0) : 0;

        return (
          <li key={l.id} className="group rounded-2xl bg-white p-3 shadow-soft ring-1 ring-stone-900/[0.04]">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  l.is_primary ? "bg-accent-50 text-accent-800" : "bg-stone-100 text-stone-600"
                }`}
              >
                {l.is_primary ? "Primary" : "Other location"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  l.status === "VERIFIED" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"
                }`}
              >
                {l.status === "VERIFIED" ? "Verified" : "Approximate"}
              </span>
              <span className="text-stone-500">{PRECISION_LABEL[l.precision]}</span>
            </div>

            <div className="mt-2 flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" strokeWidth={1.75} />
              <address className="min-w-0 flex-1 text-sm not-italic leading-snug text-ink">
                {lines.length > 0 ? (
                  lines.map((line, i) => <span key={i} className="block">{line}</span>)
                ) : (
                  <span className="text-stone-400">No address text</span>
                )}
              </address>
              {lines.length > 0 && <CopyButton value={lines.join(", ")} label="address" />}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <a
                href={mapsHref(l)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-accent-700 transition hover:text-accent-900 hover:underline hover:underline-offset-2"
              >
                Open in Maps <ExternalLink className="h-3 w-3" strokeWidth={2} />
              </a>

              {canSeeSources && l.source_type && (
                <span className="text-stone-500">
                  {SOURCE_LABEL[l.source_type]}
                  {sourceUrl && (
                    <>
                      {" · "}
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-700 hover:underline hover:underline-offset-2"
                      >
                        {hostOf(sourceUrl)}
                      </a>
                    </>
                  )}
                  {moreSources > 0 && ` · +${moreSources} more`}
                </span>
              )}
            </div>

            {canSeeSources && l.is_primary && verifiedAt && (
              <p className="mt-1.5 text-[11px] text-stone-500">Verified on {formatDate(verifiedAt)}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The group subsidiaries matched to this contact's company. */
export function SubsidiaryChips({ matches }: { matches: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {matches.map((m) => (
        <li key={m} className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-800">
          {m}
        </li>
      ))}
    </ul>
  );
}

type Tone = "info" | "warn" | "error";

/**
 * The note under the quick actions. `enrichment.status` only tracks the
 * research pass: the address and subsidiary passes never change it, so a
 * PENDING contact can already have a verified address. Say what is already
 * known instead of "queued".
 */
export function profileStatusNote({
  status,
  hasLocations,
  hasSubsidiaries,
  surface,
}: {
  status: string | null;
  hasLocations: boolean;
  hasSubsidiaries: boolean;
  surface: "panel" | "page";
}): { text: string; tone: Tone } | null {
  switch (status) {
    case "PENDING": {
      const found = [hasLocations && "an address", hasSubsidiaries && "a group match"].filter(Boolean);
      return {
        tone: "info",
        text: found.length
          ? `We have ${found.join(" and ")} for this contact. Profile research is queued and will appear here when it finishes.`
          : "Research is queued. Details will appear here when it finishes.",
      };
    }
    case "RUNNING":
      return { tone: "info", text: `Researching this contact. This ${surface} updates on its own.` };
    case "PARTIAL":
      return { tone: "warn", text: "Some public details could not be verified." };
    case "FAILED":
      return { tone: "error", text: "Research could not find public details for this contact." };
    default:
      return null;
  }
}

const TONE_CLASS: Record<Tone, string> = {
  info: "bg-accent-50 text-accent-900",
  warn: "bg-amber-50 text-amber-900",
  error: "bg-red-50 text-red-800",
};

export function ProfileStatusNote({
  status,
  hasLocations,
  hasSubsidiaries,
  surface,
  className = "",
}: {
  status: string | null;
  hasLocations: boolean;
  hasSubsidiaries: boolean;
  surface: "panel" | "page";
  className?: string;
}) {
  const note = profileStatusNote({ status, hasLocations, hasSubsidiaries, surface });
  if (!note) return null;
  return (
    <p role="status" className={`flex items-center gap-2 rounded-xl ${TONE_CLASS[note.tone]} ${className}`}>
      {status === "RUNNING" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent-500" />}
      {note.text}
    </p>
  );
}
