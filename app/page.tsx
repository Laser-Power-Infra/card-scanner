"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { RotateCcw, AlertTriangle, Download } from "lucide-react";

import UploadZone from "@/components/UploadZone";
import ScannerStage from "@/components/ScannerStage";
import ContactCard from "@/components/ContactCard";
import SearchBar from "@/components/SearchBar";
import DirectoryToolbar from "@/components/DirectoryToolbar";
import ContactTable from "@/components/ContactTable";
import ProfileCollectionButtons from "@/components/ProfileCollectionButtons";
import ResearchAllButton from "@/components/ResearchAllButton";
import ProfileSlideOver from "@/components/ProfileSlideOver";
import {useSession} from "next-auth/react";
import { resizeImageFile } from "@/lib/resizeImage";
import { deriveStateCountry } from "@/lib/location";

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
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table" | "map">("cards");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [filterState, setFilterState] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [duplicateInfo, setDuplicateInfo] = useState<{ message: string; details: any[] } | null>(null);

  const objectUrlRef = useRef<string | null>(null);

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
    <main className="bg-grain min-h-screen">
      <div className="mx-auto flex min-h-screen w-full flex-col px-6 py-12 md:flex-row md:gap-8">
        {/* Left sidebar — always visible, contains UploadZone */}
        <aside className="w-full shrink-0 md:w-80">
          <div className="md:sticky md:top-6">
            <UploadZone
              onFileSelected={handleFileSelected}
              onSpreadsheetSelected={handleSpreadsheetSelected}
            />
          </div>
        </aside>

        {/* Main content */}
        <div className="mt-8 flex-1 md:mt-0">
          {status === "scanning" && previewUrl && (
            <ScannerStage imageUrl={previewUrl} scanning />
          )}

          {contactsLoading ? (
            <div className="rounded-xl border border-slate-200 bg-white/60 p-8 text-center font-body text-sm text-slate-500">
              Loading contacts…
            </div>
          ) : contacts.length > 0 ? (
            <div className="space-y-6 mt-4">
              <div className="flex flex-wrap items-center gap-3">
                <SearchBar value={search} onChange={setSearch} compact />

                <select
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  aria-label="Filter by state"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-700 focus:border-sky-600 focus:outline-none"
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
                  className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-700 focus:border-sky-600 focus:outline-none"
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
                    className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <DirectoryToolbar
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  total={filteredContacts.length}
                  onScanAnother={reset}
                />

                <ResearchAllButton />
              </div>

              {viewMode === "cards" ? (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {filteredContacts.map((contact, index) => (
                    <div
                      key={index}
                      className="flex h-[560px] flex-col space-y-3"
                    >
                      <ContactCard
                        data={contact}
                      />

                      <ProfileCollectionButtons
                        contact={contact}
                        compact
                      />

                      { session?.user &&contact.id && contact.enrichment?.status === "DONE" ? (
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
              ) : viewMode === "map" ? (
                <ContactMap
                  contacts={filteredContacts}
                  onViewProfile={(id) => {
                    setProfileId(id);
                    setProfileOpen(true);
                  }}
                />
              ) : (
                <ContactTable
                  contacts={filteredContacts}
                  showProfiles={!!session?.user}
                  onViewProfile={(id) => {
                    setProfileId(id);
                    setProfileOpen(true);
                  }}
                />
              )}

              {result && (
                <div className="flex justify-center">
                  <button
                    onClick={downloadVCard}
                    className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2.5 font-body text-sm font-medium text-white transition-colors hover:bg-sky-700"
                  >
                    <Download className="h-4 w-4" strokeWidth={2} />
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

          <footer className="mt-12 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
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
