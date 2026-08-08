"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, AlertTriangle, Download } from "lucide-react";

import UploadZone from "@/components/UploadZone";
import ScannerStage from "@/components/ScannerStage";
import ContactCard from "@/components/ContactCard";
import SearchBar from "@/components/SearchBar";
import DirectoryToolbar from "@/components/DirectoryToolbar";
import ContactTable from "@/components/ContactTable";
import ProfileModal from "@/components/ProfileModal";

import { resizeImageFile } from "@/lib/resizeImage";

import type { CardData, ScanResponse } from "@/types/card";

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
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedContact, setSelectedContact] =
    useState<CardData | null>(null);

  const [profileOpen, setProfileOpen] =
    useState(false);

  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/contacts")
      .then((res) => res.json())
      .then((data) => setContacts(data))
      .catch((err) => console.error("Failed to load contacts:", err));
  }, []);

  const filteredContacts = contacts.filter((contact) =>
    JSON.stringify(contact).toLowerCase().includes(search.toLowerCase())
  );

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
      const isAnyNonImage = Array.from(files).some((f) => !f.type.startsWith("image/"));

      for (const file of Array.from(files)) {
        let uploadFile: File = file;

        const isImage = file.type.startsWith("image/");

        if (isImage) {
          uploadFile = await resizeImageFile(file);
        }

        const formData = new FormData();
        // images are sent under "image" for backwards compatibility,
        // other file types (csv/bsf/json) use "file"
        formData.append(isImage ? "image" : "file", uploadFile);

        const res = await fetch("/api/scan", {
          method: "POST",
          body: formData,
        });

        const json: ScanResponse = await res.json();

        if (json.success && json.data) {
          if (Array.isArray(json.data)) {
            scannedContacts.push(...json.data);
          } else {
            scannedContacts.push(json.data);
          }
        }
      }

      if (scannedContacts.length === 0) {
        throw new Error("No contact information could be extracted.");
      }

      if (isAnyNonImage) {
        // For CSV/BSF imports we add each parsed contact individually
        setContacts((prev) => [...scannedContacts, ...prev]);
        setResult(scannedContacts[0] ?? null);
        setStatus("done");
      } else {
        // Merge multiple photos of the same card (e.g. front + back) into one
        // contact: single-value fields take the first non-empty answer found,
        // list fields (numbers, emails, socials) get de-duplicated and combined.
        const merged = scannedContacts.reduce<CardData>(
          (acc, current) => ({
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
      }
    } catch (err) {
      console.error("SCAN ERROR:", err);
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }, []);

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
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-12">
        <header className="mb-10 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-sky-600">Cardfile</p>

          <h1 className="mt-3 font-display text-4xl italic text-ink">Scan a business card</h1>

          <p className="mx-auto mt-3 max-w-md font-body text-sm text-slate-600">
            Upload a photo (or front + back) and every detail on the card — name, number,
            email, site, LinkedIn — comes back as a clean digital contact.
          </p>
        </header>

        <div className="flex-1">
          {status === "idle" && <UploadZone onFileSelected={handleFileSelected} />}

          {status === "scanning" && previewUrl && (
            <ScannerStage imageUrl={previewUrl} scanning />
          )}

          {contacts.length > 0 && (
            <div className="space-y-6">
              <SearchBar value={search} onChange={setSearch} />

              <DirectoryToolbar
                viewMode={viewMode}
                setViewMode={setViewMode}
                total={filteredContacts.length}
                onScanAnother={reset}
              />

              {viewMode === "cards" ? (
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {filteredContacts.map((contact, index) => (
                    <div
                      key={index}
                      className="space-y-3"
                    >
                      <ContactCard
                        data={contact}
                      />

                      <button
                        onClick={() => {
                          setSelectedContact(contact);
                          setProfileOpen(true);
                        }}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 hover:bg-slate-100"
                      >
                        View Profile
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <ContactTable contacts={filteredContacts} />
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
        </div>

        <footer className="mt-12 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
          Runs entirely on your upload — nothing is stored
        </footer>
      </div>

      <ProfileModal
        contact={selectedContact}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
    </main>
  );
}
