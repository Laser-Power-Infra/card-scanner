"use client";

import { useCallback, useRef, useState } from "react";
import { RotateCcw, AlertTriangle } from "lucide-react";

import UploadZone from "@/components/UploadZone";
import ScannerStage from "@/components/ScannerStage";
import ContactCard from "@/components/ContactCard";

import SearchBar from "@/components/SearchBar";
import DirectoryToolbar from "@/components/DirectoryToolbar";
import ContactTable from "@/components/ContactTable";

import { resizeImageFile } from "@/lib/resizeImage";

import type { CardData, ScanResponse } from "@/types/card";



type Status = "idle" | "scanning" | "done" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [contacts, setContacts] = useState<CardData[]>([]);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const filteredContacts = contacts.filter((contact) =>
  JSON.stringify(contact)
    .toLowerCase()
    .includes(search.toLowerCase())
  );

  const reset = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    objectUrlRef.current = null;
    setStatus("idle");
    setPreviewUrl(null);
    setErrorMsg(null);
  }, []);

  const handleFileSelected = useCallback(async (file: File) => {
  const url = URL.createObjectURL(file);
  objectUrlRef.current = url;

  setPreviewUrl(url);
  setStatus("scanning");
  setErrorMsg(null);

  try {
    const uploadFile = await resizeImageFile(file);

    const formData = new FormData();
    formData.append("image", uploadFile);

    const res = await fetch("/api/scan", {
      method: "POST",
      body: formData,
    });

    const responseText = await res.text();

    console.log("========== API RESPONSE ==========");
    console.log(responseText);
    console.log("==================================");

    let json: ScanResponse | null = null;

    try {
      json = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Server returned HTML instead of JSON.\n\n${responseText.slice(
          0,
          300
        )}`
      );
    }

    if (!res.ok) {
      throw new Error(
        json?.error ||
          `Request failed with status ${res.status}`
      );
    }

    if (!json.success || !json.data) {
      throw new Error(
        json.error ?? "Could not read this card."
      );
    }

    setContacts((prev) => [json.data, ...prev]);
    setStatus("done");
  } catch (err) {
    console.error("SCAN ERROR:", err);

    setErrorMsg(
      err instanceof Error
        ? err.message
        : "Something went wrong."
    );

    setStatus("error");
  }
}, []);

  

  return (
    <main className="bg-grain min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-12">
        <header className="mb-10 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-copper">
            Cardfile
          </p>
          <h1 className="mt-3 font-display text-4xl italic text-ivory">
            Scan a business card
          </h1>
          <p className="mx-auto mt-3 max-w-md font-body text-sm text-ivory/60">
            Upload a photo and every detail on the card — name, number, email, site,
            LinkedIn — comes back as a clean digital contact.
          </p>
        </header>

        <div className="flex-1">
          {status === "idle" && <UploadZone onFileSelected={handleFileSelected} />}

          {status === "scanning" && previewUrl && (
            <ScannerStage imageUrl={previewUrl} scanning />
          )}

          {contacts.length > 0 && (
  <div className="space-y-6">

    <SearchBar
      value={search}
      onChange={setSearch}
    />

    <DirectoryToolbar
      viewMode={viewMode}
      setViewMode={setViewMode}
      total={filteredContacts.length}
      onScanAnother={reset}
    />

    {viewMode === "cards" ? (
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {filteredContacts.map((contact, index) => (
          <ContactCard
            key={index}
            data={contact}
          />
        ))}
      </div>
    ) : (
      <ContactTable contacts={filteredContacts} />
    )}

  </div>
)}

          {status === "error" && (
            <div className="flex flex-col items-center gap-6 text-center">
              {previewUrl && (
                <div className="w-full max-w-md overflow-hidden rounded-xl border border-ivory/15 opacity-60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Upload that failed to scan" className="w-full object-contain" />
                </div>
              )}
              <div className="flex items-center gap-2 text-copper">
                <AlertTriangle className="h-5 w-5" strokeWidth={2} />
                <p className="max-w-md break-words font-body text-sm">{errorMsg}</p>
              </div>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2.5 font-body text-sm font-medium text-graphite transition-colors hover:bg-copperdim"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={2} />
                Try again
              </button>
            </div>
          )}
        </div>

        <footer className="mt-12 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-ivory/30">
          Runs entirely on your upload — nothing is stored
        </footer>
      </div>
    </main>
  );
}
