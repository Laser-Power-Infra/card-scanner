"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { RotateCcw, AlertTriangle, Download, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import UploadZone from "@/components/UploadZone";
import ScannerStage from "@/components/ScannerStage";
import ContactCard from "@/components/ContactCard";
import SearchBar from "@/components/SearchBar";
import DirectoryToolbar from "@/components/DirectoryToolbar";
import ContactTable from "@/components/ContactTable";
import ProfileCollectionButtons from "@/components/ProfileCollectionButtons";
import ResearchAllButton from "@/components/ResearchAllButton";
import ProfileSlideOver from "@/components/ProfileSlideOver";
import { useSession } from "next-auth/react";
import { resizeImageFile } from "@/lib/resizeImage";
import { deriveStateCountry } from "@/lib/location";

import type { CardData, ScanResponse } from "@/types/card";

const ContactMap = dynamic(
  () => import("@/components/ContactMap"),
  { ssr: false }
);

type Status = "idle" | "scanning" | "done" | "error";

const CARDS_PER_PAGE = 100;

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
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table" | "map">("cards");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [filterState, setFilterState] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [duplicateInfo, setDuplicateInfo] = useState<{ message: string; details: any[] } | null>(null);
  const [cardPage, setCardPage] = useState(1);

  const objectUrlRef = useRef<string | null>(null);
  const cardScrollRef = useRef<HTMLDivElement | null>(null);

  const loadContacts = useCallback(async () => {
    setContactsLoading(true);
    try {
      const res = await fetch("/api/contacts");
      const data = await res.json();
      setContacts(data);
    } catch (err) {
      console.error("Failed to load contacts:", err);
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

  // Reset card page to 1 whenever filters or search change
  useEffect(() => {
    setCardPage(1);
  }, [search, filterState, filterCountry]);

  // Card pagination calculations
  const totalCards = filteredContacts.length;
  const totalCardPages = Math.max(1, Math.ceil(totalCards / CARDS_PER_PAGE));
  const currentCardPage = Math.min(cardPage, totalCardPages);
  const cardPageStart = (currentCardPage - 1) * CARDS_PER_PAGE;
  const cardPageEnd = Math.min(cardPageStart + CARDS_PER_PAGE, totalCards);
  const paginatedCards = filteredContacts.slice(cardPageStart, cardPageEnd);

  const goToCardPage = useCallback((page: number) => {
    setCardPage(page);
    cardScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

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
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
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
  const downloadVCard = useCallback(() => {
    if (!result) return;

    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      result.fullName ? `FN:${result.fullName}` : "",
      result.company ? `ORG:${result.company}` : "",
      result.jobTitle ? `TITLE:${result.jobTitle}` : "",
      ...(result.mobileNumbers ?? []).map((p) => `TEL;TYPE=CELL:${p}`),
      ...(result.telephoneNumbers ?? []).map((p) => `TEL;TYPE=WORK:${p}`),
      ...(result.emails ?? []).map((e) => `EMAIL:${e}`),
      result.website ? `URL:${result.website}` : "",
      result.address ? `ADR;TYPE=WORK:;;${result.address.replace(/\n/g, " ")}` : "",
      "END:VCARD",
    ].filter(Boolean);

    const blob = new Blob([lines.join("\n")], { type: "text/vcard" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.fullName ?? "contact"}.vcf`;
    a.click();

    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <main className="bg-grain min-h-screen md:h-[calc(100vh-64px)] md:overflow-hidden">
      <div className="mx-auto flex w-full flex-col px-6 py-4 md:flex-row md:gap-6 md:h-full md:overflow-hidden">
        {/* Left sidebar — always visible, contains UploadZone */}
        <aside className="w-full shrink-0 md:w-80 md:h-full md:overflow-y-auto">
          <div className="md:sticky md:top-2">
            <UploadZone
              onFileSelected={handleFileSelected}
              onSpreadsheetSelected={handleSpreadsheetSelected}
            />
          </div>
        </aside>

        {/* Main content */}
        <div className="mt-4 flex-1 md:mt-0 flex flex-col min-h-0 md:h-full md:overflow-hidden">
          {status === "scanning" && previewUrl && (
            <ScannerStage imageUrl={previewUrl} scanning />
          )}

          {contactsLoading ? (
            <div className="rounded-xl border border-slate-200 bg-white/60 p-8 text-center font-body text-sm text-slate-500">
              Loading contacts…
            </div>
          ) : contacts.length > 0 ? (
            <div className="flex flex-col h-full min-h-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <SearchBar value={search} onChange={setSearch} compact />

                <select
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  aria-label="Filter by state"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-sky-600 focus:outline-none"
                >
                  <option value="">State (All)</option>
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
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-sky-600 focus:outline-none"
                >
                  <option value="">Country (All)</option>
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
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                <DirectoryToolbar
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  total={filteredContacts.length}
                />

                <ResearchAllButton />
              </div>

              {viewMode === "cards" ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {/* Cards pagination header */}
                  <div className="flex items-center justify-between px-1 py-2 shrink-0">
                    <span className="text-xs font-medium text-slate-500">
                      Showing {totalCards === 0 ? 0 : cardPageStart + 1}–{cardPageEnd} of {totalCards} cards
                    </span>
                    {totalCardPages > 1 && (
                      <span className="text-xs text-slate-400">
                        Page {currentCardPage} of {totalCardPages}
                      </span>
                    )}
                  </div>

                  <div ref={cardScrollRef} className="flex-1 min-h-0 overflow-y-auto pr-1">
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 pb-6">
                      {paginatedCards.map((contact, index) => (
                        <div
                          key={cardPageStart + index}
                          className="flex h-[560px] flex-col space-y-3"
                        >
                          <ContactCard
                            data={contact}
                          />

                          <ProfileCollectionButtons
                            contact={contact}
                            compact
                          />

                          {session?.user && contact.id && contact.enrichment?.status === "DONE" ? (
                            <button
                              onClick={() => {
                                setProfileId(contact.id!);
                                setProfileOpen(true);
                              }}
                              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-center text-sm text-slate-900 hover:bg-slate-100"
                            >
                              View Profile
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Cards pagination footer */}
                  {totalCardPages > 1 && (
                    <div className="flex items-center justify-between px-2 py-2.5 border-t border-slate-200 bg-white/80 backdrop-blur-sm rounded-b-xl shrink-0">
                      <span className="text-xs text-slate-500">
                        Page {currentCardPage} of {totalCardPages} · {totalCards} total
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => goToCardPage(1)}
                          disabled={currentCardPage <= 1}
                          title="First page"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronsLeft size={14} />
                        </button>
                        <button
                          onClick={() => goToCardPage(currentCardPage - 1)}
                          disabled={currentCardPage <= 1}
                          title="Previous page"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <span className="px-3 text-xs font-semibold text-slate-700 tabular-nums">
                          {currentCardPage} / {totalCardPages}
                        </span>
                        <button
                          onClick={() => goToCardPage(currentCardPage + 1)}
                          disabled={currentCardPage >= totalCardPages}
                          title="Next page"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronRight size={14} />
                        </button>
                        <button
                          onClick={() => goToCardPage(totalCardPages)}
                          disabled={currentCardPage >= totalCardPages}
                          title="Last page"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronsRight size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : viewMode === "map" ? (
                <div className="flex-1 min-h-0 h-full overflow-hidden">
                  <ContactMap
                    contacts={filteredContacts}
                    onViewProfile={(id) => {
                      setProfileId(id);
                      setProfileOpen(true);
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <ContactTable
                    contacts={filteredContacts}
                    showProfiles={!!session?.user}
                    onViewProfile={(id) => {
                      setProfileId(id);
                      setProfileOpen(true);
                    }}
                  />
                </div>
              )}

              {result && (
                <div className="flex justify-center shrink-0 pt-1">
                  <button
                    onClick={downloadVCard}
                    className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2 font-body text-xs font-medium text-white transition-colors hover:bg-sky-700"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={2} />
                    Save latest contact (.vcf)
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white/60 p-8 text-center font-body text-sm text-slate-500">
              No contacts yet. Upload a business card to get started.
            </div>
          )}

          {duplicateInfo && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 mt-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-sky-800">{duplicateInfo.message}</p>
                <button
                  onClick={() => setDuplicateInfo(null)}
                  className="shrink-0 text-sky-600 hover:text-sky-800"
                >
                  Dismiss
                </button>
              </div>
              {duplicateInfo.details.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-sky-700">
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
            <div className="flex flex-col items-center gap-6 text-center">
              {previewUrl && (
                <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white/80 opacity-90">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Upload that failed to scan"
                    className="w-full object-contain"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 text-sky-600">
                <AlertTriangle className="h-5 w-5" strokeWidth={2} />
                <p className="font-body text-sm">{errorMsg}</p>
              </div>

              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2.5 font-body text-sm font-medium text-white transition-colors hover:bg-sky-700"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={2} />
                Try again
              </button>
            </div>
          )}

          <footer className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 shrink-0">
            Runs entirely on your upload — nothing is stored
          </footer>
        </div>
      </div>

      <ProfileSlideOver
        contactId={profileId}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
    </main>
  );
}

