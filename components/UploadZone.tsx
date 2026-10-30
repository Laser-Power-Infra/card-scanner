"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, UploadCloud, FileSpreadsheet, ScanLine, X } from "lucide-react";

import { MAX_CARD_PHOTOS } from "@/lib/scan";

interface UploadZoneProps {
  onFileSelected: (files: File[]) => void;
  onSpreadsheetSelected?: (file: File) => void;
  disabled?: boolean;
}

export default function UploadZone({
  onFileSelected,
  onSpreadsheetSelected,
  disabled,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [staged, setStaged] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const spreadsheetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = staged.map((file) => URL.createObjectURL(file));
    setPreviews(urls);

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [staged]);

  const addFiles = useCallback((files: FileList | File[] | null) => {
    const incoming = Array.from(files ?? []).filter((file) =>
      file.type.startsWith("image/")
    );

    if (incoming.length === 0) return;

    setStaged((current) => [...current, ...incoming].slice(0, MAX_CARD_PHOTOS));
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(event.target.files);
      // Allow choosing the same file again after removing it.
      event.target.value = "";
    },
    [addFiles]
  );

  const removeFile = useCallback((index: number) => {
    setStaged((current) => current.filter((_, i) => i !== index));
  }, []);

  const handleScan = useCallback(() => {
    if (staged.length === 0) return;

    onFileSelected([...staged]);
    setStaged([]);
  }, [onFileSelected, staged]);

  const full = staged.length >= MAX_CARD_PHOTOS;
  const hasPhotos = staged.length > 0;

  return (
    <section aria-label="Add contacts" className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-[1.7rem] font-medium leading-[1.1] tracking-tight text-ink">
          Scan a card,
          <br />
          <span className="italic text-accent-700">keep the contact.</span>
        </h1>
        <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-stone-500">
          Add up to {MAX_CARD_PHOTOS} photos. Front and back merge into one contact.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);

          if (!disabled) {
            addFiles(e.dataTransfer.files);
          }
        }}
        className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-5 py-8 text-center transition duration-300 ease-spring ${
          isDragging
            ? "scale-[1.01] border-accent-500 bg-accent-50"
            : "border-stone-300 bg-white/70 hover:border-stone-400 hover:bg-white"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        {hasPhotos ? (
          <div className="grid w-full grid-cols-2 gap-2">
            {previews.map((url, index) => (
              <div key={url} className="relative overflow-hidden rounded-xl ring-1 ring-stone-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Card photo ${index + 1}`}
                  className="aspect-[1.6/1] w-full object-cover"
                />
                <span className="absolute left-1.5 top-1.5 rounded-md bg-ink/75 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                  {index === 0 ? "Front" : "Back"}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  aria-label={`Remove photo ${index + 1}`}
                  className="absolute right-1.5 top-1.5 rounded-full bg-white/90 p-1 text-stone-700 shadow-soft transition hover:bg-white"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-xl bg-accent-50 transition duration-300 ease-spring ${
                isDragging ? "-translate-y-1 bg-accent-100" : ""
              }`}
            >
              <UploadCloud className="h-6 w-6 text-accent-700" strokeWidth={1.5} />
            </div>

            <div>
              <p className="text-sm font-medium text-ink">
                {isDragging ? "Release to add photos" : "Drop card photos here"}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                JPEG, PNG or WebP, up to 8 MB each
              </p>
            </div>
          </>
        )}

        <div className="flex w-full flex-col gap-2 pt-1">
          {hasPhotos ? (
            <>
              {!full && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-ink transition duration-200 ease-spring hover:-translate-y-px hover:border-stone-300 hover:shadow-soft active:translate-y-0 active:scale-[.98]"
                  >
                    <Camera className="h-4 w-4" strokeWidth={1.75} />
                    Add with camera
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-ink transition duration-200 ease-spring hover:-translate-y-px hover:border-stone-300 hover:shadow-soft active:translate-y-0 active:scale-[.98]"
                  >
                    <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
                    Add another picture
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handleScan}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-700 px-5 py-2.5 text-sm font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 hover:shadow-lift active:translate-y-0 active:scale-[.98]"
              >
                <ScanLine className="h-4 w-4" strokeWidth={1.75} />
                {staged.length === 1 ? "Scan card" : "Scan 2 photos"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-700 px-5 py-2.5 text-sm font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 hover:shadow-lift active:translate-y-0 active:scale-[.98]"
              >
                <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
                Choose photos
              </button>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-ink transition duration-200 ease-spring hover:-translate-y-px hover:border-stone-300 hover:shadow-soft active:translate-y-0 active:scale-[.98]"
              >
                <Camera className="h-4 w-4" strokeWidth={1.75} />
                Use camera
              </button>
            </>
          )}
        </div>
      </div>

      {onSpreadsheetSelected && (
        <button
          type="button"
          onClick={() => spreadsheetInputRef.current?.click()}
          className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition duration-200 hover:bg-stone-900/5"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-200/70 text-stone-600 transition group-hover:bg-white group-hover:text-accent-700">
            <FileSpreadsheet className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span>
            <span className="block text-sm font-medium text-ink">Import a spreadsheet</span>
            <span className="block text-xs text-stone-500">CSV, XLSX or XLS</span>
          </span>
        </button>
      )}

      <div className="hidden">
        {/* Gallery Upload */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={handleInputChange}
        />

        {/* Camera Upload */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleInputChange}
        />

        {/* Spreadsheet Upload */}
        <input
          ref={spreadsheetInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && onSpreadsheetSelected) {
              setStaged([]);
              onSpreadsheetSelected(file);
            }
            e.target.value = "";
          }}
        />
      </div>
    </section>
  );
}
