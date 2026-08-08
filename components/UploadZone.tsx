"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, ImagePlus, UploadCloud } from "lucide-react";

interface UploadZoneProps {
  onFileSelected: (files: FileList) => void;
  disabled?: boolean;
}

export default function UploadZone({
  onFileSelected,
  disabled,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const validFiles = Array.from(files).filter((file) =>
        file.type.startsWith("image/") ||
        file.type === "text/csv" ||
        file.name.toLowerCase().endsWith(".csv") ||
        file.name.toLowerCase().endsWith(".bsf") ||
        file.type === "application/json"
      );

      if (validFiles.length === 0) return;

      // Create a FileList-like object to pass only the valid files
      const dt = new DataTransfer();
      validFiles.forEach((f) => dt.items.add(f));

      onFileSelected(dt.files);
    },
    [onFileSelected]
  );

  return (
    <div className="w-full">
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
            handleFiles(e.dataTransfer.files);
          }
        }}
        className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
          isDragging
            ? "border-sky-600 bg-sky-50"
            : "border-slate-300 bg-white shadow-sm hover:border-slate-400"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-300 bg-white shadow-sm">
          <UploadCloud
            className="h-6 w-6 text-sky-600"
            strokeWidth={1.5}
          />
        </div>

        <div>
          <p className="font-display text-lg text-ink">
            Drop business card images here
          </p>

          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-500">
            Select multiple images • JPEG, PNG, WebP • up to 8MB each
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2.5 font-body text-sm font-medium text-white transition-colors hover:bg-sky-700"
          >
            <ImagePlus
              className="h-4 w-4"
              strokeWidth={2}
            />
            Choose Photos
          </button>

          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-5 py-2.5 font-body text-sm font-medium text-sky-700 transition-colors hover:bg-slate-200"
          >
            <Camera
              className="h-4 w-4"
              strokeWidth={2}
            />
            Use Camera
          </button>
        </div>

        {/* Gallery Upload */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,text/csv,.csv,.bsf,application/json"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {/* Camera Upload */}
        <input
          ref={cameraInputRef}
          type="file"
          multiple
          accept="image/*,text/csv,.csv,.bsf,application/json"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    </div>
  );
}