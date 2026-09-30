"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RotateCcw, AlertTriangle, Download, X, Info, ScanLine, LayoutGrid, Map as MapIcon, Plus } from "lucide-react";

import UploadZone from "@/components/UploadZone";
import ScannerStage from "@/components/ScannerStage";
import ContactCard from "@/components/ContactCard";
import SearchBar from "@/components/SearchBar";
import DirectoryToolbar from "@/components/DirectoryToolbar";
import ContactTable from "@/components/ContactTable";
import ProfileCollectionButtons from "@/components/ProfileCollectionButtons";
import ResearchAllButton from "@/components/ResearchAllButton";
import {useSession} from "next-auth/react";
import { resizeImageFile } from "@/lib/resizeImage";
import { deriveStateCountry } from "@/lib/location";
import { downloadVCard } from "@/lib/contact";

import type { CardData, ScanResponse } from "@/types/card";

const ContactMap = dynamic(
  () => import("@/components/ContactMap"),
  { ssr: false }
);

type Status = "idle" | "scanning" | "done" | "error";

const EMPTY_CARD: CardData = {
  fullName: null,
  jobTitle: null,
  company: null,
  mobileNumbers: [],
  telephoneNumbers: [],
  emails: [],
  website: null,
  address: null,
  companyLocation: null,
  linkedin: null,
  otherSocials: [],
  rawNotes: null,
};

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<CardData | null>(null);
  const [contacts, setContacts] = useState<CardData[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table" | "map">("cards");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filterState, setFilterState] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [scanSheetOpen, setScanSheetOpen] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<{ message: string; details: any[] } | null>(null);

  const objectUrlRef = useRef<string | null>(null);

  const loadContacts = useCallback(async () => {
    setContactsLoading(true);
    setContactsError(null);
    try {
      const res = await fetch("/api/contacts");
      const data = await res.json();
      // API returns { success: false, error } on failure; never store a non-array.
      if (!res.ok || !Array.isArray(data)) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setContacts(data);
    } catch (err) {
      console.error("Failed to load contacts:", err);
      setContactsError(err instanceof Error ? err.message : "Failed to load contacts");
    } finally {
      setContactsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContacts();

    // Only refetch on a genuine back/forward restore (bfcache), not every
    // tab focus or the initial load.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) loadContacts();
    };

    window.addEventListener("pageshow", onShow);

    return () => {
      window.removeEventListener("pageshow", onShow);
    };
  }, [loadContacts]);

  const { stateOptions, countryOptions } = useMemo(() => {
    const states = new Set<string>();
    const countries = new Set<string>();

    for (const c of contacts) {
      const { state, country } = deriveStateCountry({
        companyLocation: c.companyLocation,
        address: c.address,
      });
      if (state) states.add(state);
      if (country) countries.add(country);
    }

    return {
      stateOptions: Array.from(states).sort(),
      countryOptions: Array.from(countries).sort(),
    };
  }, [contacts]);

  const filteredContacts = contacts.filter((contact) => {
    const matchesSearch = JSON.stringify(contact)
      .toLowerCase()
      .includes(search.toLowerCase());

    const { state, country } = deriveStateCountry({
      companyLocation: contact.companyLocation,
      address: contact.address,
    });

    const matchesState = !filterState || (state ?? "") === filterState;
    const matchesCountry =
      !filterCountry || (country ?? "") === filterCountry;

    return matchesSearch && matchesState && matchesCountry;
  });

  const reset = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    objectUrlRef.current = null;
    setStatus("idle");
    setPreviewUrl(null);
    setResult(null);
    setErrorMsg(null);
  }, []);

  const handleFileSelected = useCallback(async (files: FileList) => {
    const firstFile = files[0];
    if (!firstFile) return;

    const url = URL.createObjectURL(firstFile);
    objectUrlRef.current = url;

    setPreviewUrl(url);
    setStatus("scanning");
    setErrorMsg(null);

    try {
      const scannedContacts: CardData[] = [];
      const imageDuplicates: { name: string; matchedBy: string }[] = [];

      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith("image/");
        const uploadFile = isImage ? await resizeImageFile(file) : file;

        const formData = new FormData();
        formData.append("image", uploadFile);

        const res = await fetch("/api/scan", {
          method: "POST",
          body: formData,
        });

        const json: ScanResponse & { alreadyExists?: boolean; matchedBy?: string } = await res.json();

        if (json.success && json.data) {
          const card = Array.isArray(json.data) ? json.data[0] : json.data;
          if (card) scannedContacts.push(card);

          if (json.alreadyExists && card) {
            imageDuplicates.push({
              name: card.fullName ?? "Unknown",
              matchedBy: json.matchedBy ?? "existing contact",
            });
          }
        }
      }

      if (scannedContacts.length === 0 && imageDuplicates.length === 0) {
        throw new Error("No contact information could be extracted.");
      }

      // Merge multiple photos of the same card (e.g. front + back) into one
      // contact: single-value fields take the first non-empty answer found,
      // list fields (numbers, emails, socials) get de-duplicated and combined.
      const merged = scannedContacts.reduce<CardData>(
        (acc, current) => ({
          id: acc.id || current.id,

          fullName: acc.fullName || current.fullName,
          jobTitle: acc.jobTitle || current.jobTitle,
          company: acc.company || current.company,

          mobileNumbers: [
            ...new Set([...(acc.mobileNumbers || []), ...(current.mobileNumbers || [])]),
          ],

          telephoneNumbers: [
            ...new Set([...(acc.telephoneNumbers || []), ...(current.telephoneNumbers || [])]),
          ],

          emails: [...new Set([...(acc.emails || []), ...(current.emails || [])])],

          website: acc.website || current.website,
          address: acc.address || current.address,
          companyLocation: acc.companyLocation || current.companyLocation,
          linkedin: acc.linkedin || current.linkedin,

          otherSocials: [...(acc.otherSocials || []), ...(current.otherSocials || [])],

          rawNotes: acc.rawNotes || current.rawNotes,
        }),
        { ...EMPTY_CARD }
      );

      setResult(merged);
      setContacts((prev) => [merged, ...prev]);
      setStatus("done");

      if (imageDuplicates.length > 0) {
        const names = imageDuplicates.map((d) => d.name).join(", ");
        setDuplicateInfo({
          message: `${imageDuplicates.length} duplicate${imageDuplicates.length !== 1 ? "s" : ""} skipped (${names}). Data merged.`,
          details: imageDuplicates,
        });
        setTimeout(() => setDuplicateInfo(null), 8000);
      } else {
        setDuplicateInfo(null);
      }
    } catch (err) {
      console.error("SCAN ERROR:", err);
      setErrorMsg(err instanceof Error ? err.message : "The card couldn't be read. Try a sharper, well-lit photo.");
      setStatus("error");
    }
  }, []);

  const handleSpreadsheetSelected = useCallback(async (file: File) => {
    setErrorMsg(null);
    setStatus("scanning");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/scan", {
        method: "POST",
        body: formData,
      });

      const json: ScanResponse = await res.json();

      if (!json.success || !json.data) {
        throw new Error(json.error || "Failed to import spreadsheet.");
      }

      const imported = Array.isArray(json.data) ? json.data : [json.data];
      const duplicates = (json as any).duplicates ?? [];

      if (imported.length === 0 && duplicates.length === 0) {
        throw new Error(
          "No valid rows found. Name and company are required per row."
        );
      }

      setContacts((prev) => [...imported, ...prev]);
      setResult(imported[0] ?? null);
      setStatus("done");

      if (duplicates.length > 0) {
        setDuplicateInfo({
          message: `${imported.length} new contact${imported.length !== 1 ? "s" : ""} imported. ${duplicates.length} duplicate${duplicates.length !== 1 ? "s" : ""} skipped.`,
          details: duplicates,
        });
        setTimeout(() => setDuplicateInfo(null), 10000);
      } else {
        setDuplicateInfo(null);
      }
    } catch (err) {
      console.error("IMPORT ERROR:", err);
      setErrorMsg(err instanceof Error ? err.message : "Import failed.");
      setStatus("error");
    }
  }, []);

    const { data: session } = useSession();
  const router = useRouter();
  const openProfile = useCallback((id: string) => router.push(`/contacts/${id}`), [router]);

  return (
    <main id="main" className="bg-grain min-h-[100dvh] md:h-[calc(100dvh-64px)] md:min-h-0 md:overflow-hidden">
      <div className="mx-auto flex w-full flex-col px-4 pb-28 pt-3 sm:px-6 md:h-full md:py-6 md:flex-row md:gap-8 md:overflow-hidden">
        {/* Left sidebar (desktop). On mobile the upload panel opens from the dock. */}
        <aside className="hidden shrink-0 md:block md:h-full md:w-80 md:overflow-y-auto">
          <div className="md:sticky md:top-0 md:pb-6">
            <UploadZone
              onFileSelected={handleFileSelected}
              onSpreadsheetSelected={handleSpreadsheetSelected}
            />
          </div>
        </aside>

        {/* Main content */}
        <div className="flex min-h-0 flex-1 flex-col md:h-full md:overflow-hidden">
          {status === "scanning" && previewUrl && (
            <ScannerStage imageUrl={previewUrl} scanning />
          )}

          {contactsError && !contactsLoading && (
            <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
              <p className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2} />
                Couldn&apos;t load your contacts. {contactsError}.
              </p>
              <button
                onClick={loadContacts}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 font-medium text-red-800 ring-1 ring-red-200 transition hover:bg-red-100 active:scale-[.98]"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                Retry
              </button>
            </div>
          )}

          {contactsLoading ? (
            <div role="status" aria-label="Loading contacts" className="space-y-4">
              <div className="flex gap-2">
                <div className="skeleton h-10 w-72" />
                <div className="skeleton h-10 w-28" />
                <div className="skeleton h-10 w-28" />
              </div>
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="space-y-3 rounded-2xl bg-white p-5 shadow-soft">
                    <div className="flex gap-3">
                      <div className="skeleton h-11 w-11 rounded-xl" />
                      <div className="flex-1 space-y-2 pt-1">
                        <div className="skeleton h-4 w-3/4" />
                        <div className="skeleton h-3 w-1/2" />
                      </div>
                    </div>
                    <div className="skeleton h-3 w-full" />
                    <div className="skeleton h-3 w-5/6" />
                    <div className="skeleton h-3 w-2/3" />
                  </div>
                ))}
              </div>
            </div>
          ) : contacts.length > 0 ? (
            <div className="flex h-full min-h-0 flex-col gap-4">
              <div className="sticky top-16 z-40 -mx-4 flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200/70 bg-paper/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
                <SearchBar value={search} onChange={setSearch} compact />

                <select
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  aria-label="Filter by state"
                  className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white py-2 pl-3 pr-8 text-sm text-ink shadow-soft md:flex-none transition duration-200 hover:border-stone-300 focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/10"
                >
                  <option value="">All states</option>
                  {stateOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <select
                  value={filterCountry}
                  onChange={(e) => setFilterCountry(e.target.value)}
                  aria-label="Filter by country"
                  className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white py-2 pl-3 pr-8 text-sm text-ink shadow-soft md:flex-none transition duration-200 hover:border-stone-300 focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/10"
                >
                  <option value="">All countries</option>
                  {countryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                {(filterState || filterCountry) && (
                  <button
                    onClick={() => {
                      setFilterState("");
                      setFilterCountry("");
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium text-stone-500 transition hover:bg-stone-900/5 hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                    Clear filters
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="hidden md:block">
                  <DirectoryToolbar
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    total={filteredContacts.length}
                    onScanAnother={reset}
                  />
                </div>

                <ResearchAllButton />
              </div>

              {viewMode === "cards" ? (
                <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pt-1">
                  {filteredContacts.length === 0 ? (
                    <div className="flex flex-col items-center py-20 text-center">
                      <p className="font-display text-xl text-ink">No matches</p>
                      <p className="mt-1 text-sm text-stone-500">
                        Try a different search or clear the filters.
                      </p>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] items-stretch gap-5 pb-6">
                    {filteredContacts.map((contact, index) => (
                      <div
                        key={contact.id ?? index}
                        className="animate-rise"
                        style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
                      >
                        <ContactCard
                          data={contact}
                          profileHref={session?.user && contact.id ? `/contacts/${contact.id}` : undefined}
                          actions={
                            session?.user?.role === "DEVELOPER" ? (
                              <ProfileCollectionButtons contact={contact} compact />
                            ) : undefined
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : viewMode === "map" ? (
                <div className="fixed inset-x-0 bottom-0 top-16 z-30 md:static md:z-auto md:h-full md:min-h-0 md:flex-1 md:overflow-hidden">
                  <ContactMap
                    contacts={filteredContacts}
                  />
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <ContactTable
                    contacts={filteredContacts}
                    showProfiles={!!session?.user}
                    onViewProfile={openProfile}
                  />
                </div>
              )}

              {result && (
                <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl bg-white px-4 py-2.5 shadow-soft">
                  <p className="min-w-0 truncate text-sm text-stone-500">
                    Latest scan: <span className="font-medium text-ink">{result.fullName ?? result.company ?? "Unnamed contact"}</span>
                  </p>
                  <button
                    onClick={() => downloadVCard(result)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-accent-700 px-3.5 py-1.5 text-sm font-medium text-white transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 active:scale-[.98]"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={2} />
                    Save .vcf
                  </button>
                </div>
              )}
            </div>
          ) : (
            status !== "scanning" && (
              <div className="flex flex-1 animate-rise flex-col items-center justify-center py-16 text-center">
                <div className="relative mb-6 h-28 w-44" aria-hidden>
                  <div className="absolute inset-0 -rotate-6 rounded-xl bg-white shadow-soft ring-1 ring-stone-900/[0.04]" />
                  <div className="absolute inset-0 rotate-3 rounded-xl bg-white p-4 shadow-lift ring-1 ring-stone-900/[0.04]">
                    <div className="h-3 w-20 rounded bg-accent-100" />
                    <div className="mt-3 h-2 w-28 rounded bg-stone-100" />
                    <div className="mt-2 h-2 w-24 rounded bg-stone-100" />
                    <div className="mt-2 h-2 w-16 rounded bg-stone-100" />
                  </div>
                </div>
                <h2 className="font-display text-2xl font-medium text-ink">Your cardfile is empty</h2>
                <p className="mt-2 max-w-[42ch] text-sm leading-relaxed text-stone-500">
                  Scan your first business card. Name, phone, email and address
                  are pulled out for you.
                </p>
                <button
                  onClick={() => setScanSheetOpen(true)}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-accent-700 px-5 py-2.5 text-sm font-medium text-white shadow-soft transition active:scale-[.98] md:hidden"
                >
                  <ScanLine className="h-4 w-4" strokeWidth={1.75} />
                  Scan a card
                </button>
                <p className="mt-5 hidden items-center gap-2 text-sm font-medium text-accent-700 md:inline-flex">
                  <ScanLine className="h-4 w-4" strokeWidth={1.75} />
                  Use the upload area on the left
                </p>
              </div>
            )
          )}

          {duplicateInfo && (
            <div role="status" className="mt-4 animate-rise rounded-xl bg-accent-50 p-4 ring-1 ring-accent-200/70">
              <div className="flex items-start justify-between gap-3">
                <p className="flex items-start gap-2 text-sm font-medium text-accent-900">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {duplicateInfo.message}
                </p>
                <button
                  onClick={() => setDuplicateInfo(null)}
                  aria-label="Dismiss"
                  className="shrink-0 rounded-md p-1 text-accent-700 transition hover:bg-accent-100"
                >
                  <X className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
              {duplicateInfo.details.length > 0 && (
                <ul className="mt-2 space-y-1 pl-6 text-xs text-accent-800">
                  {duplicateInfo.details.map((d, i) => (
                    <li key={i}>
                      {d.row !== undefined ? `Row ${d.row + 2}: ` : ""}
                      {d.name || d.fullName || "Unknown"} — {d.matchedBy}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {status === "error" && (
            <div role="alert" className="mx-auto mt-4 flex w-full max-w-md animate-rise flex-col items-center gap-5 rounded-2xl bg-white p-6 text-center shadow-lift">
              {previewUrl && (
                <div className="w-full overflow-hidden rounded-xl opacity-80 grayscale-[40%]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Upload that failed to scan"
                    className="w-full object-contain"
                  />
                </div>
              )}

              <div>
                <p className="flex items-center justify-center gap-2 font-medium text-red-800">
                  <AlertTriangle className="h-4 w-4" strokeWidth={2} />
                  Scan failed
                </p>
                <p className="mt-1 text-sm text-stone-500">{errorMsg}</p>
              </div>

              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-xl bg-accent-700 px-5 py-2.5 text-sm font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 active:scale-[.98]"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={2} />
                Try again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile dock */}
      <nav
        aria-label="Directory"
        className="fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 md:hidden"
      >
        <div className="mx-auto grid max-w-sm grid-cols-3 items-center rounded-2xl bg-white/90 p-1.5 shadow-pop ring-1 ring-stone-900/[0.06] backdrop-blur-md">
          <button
            onClick={() => setViewMode("cards")}
            aria-current={viewMode !== "map" ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition ${viewMode !== "map" ? "text-accent-800" : "text-stone-500"}`}
          >
            <LayoutGrid className="h-5 w-5" strokeWidth={1.75} />
            Cards
          </button>
          <button
            onClick={() => setScanSheetOpen(true)}
            aria-label="Scan a card"
            className="mx-auto -my-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-700 text-white shadow-lift ring-4 ring-paper transition active:scale-95"
          >
            <Plus className="h-6 w-6" strokeWidth={2} />
          </button>
          <button
            onClick={() => setViewMode("map")}
            aria-current={viewMode === "map" ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition ${viewMode === "map" ? "text-accent-800" : "text-stone-500"}`}
          >
            <MapIcon className="h-5 w-5" strokeWidth={1.75} />
            Map
          </button>
        </div>
      </nav>

      {/* Mobile scan sheet */}
      {scanSheetOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Scan a card">
          <div
            className="absolute inset-0 animate-[fade_0.2s_ease-out_both] bg-ink/30 backdrop-blur-[2px]"
            onClick={() => setScanSheetOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[90dvh] animate-[sheet-up_0.35s_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-y-auto rounded-t-3xl bg-paper px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 shadow-pop">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-stone-300" />
            <UploadZone
              onFileSelected={(files) => {
                setScanSheetOpen(false);
                setViewMode("cards");
                handleFileSelected(files);
              }}
              onSpreadsheetSelected={(file) => {
                setScanSheetOpen(false);
                setViewMode("cards");
                handleSpreadsheetSelected(file);
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}
