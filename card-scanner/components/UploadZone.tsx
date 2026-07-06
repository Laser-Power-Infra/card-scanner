"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, ImagePlus, UploadCloud } from "lucide-react";

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

export default function UploadZone({ onFileSelected, disabled }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.type.startsWith("image/")) return;
      onFileSelected(file);
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
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
        className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
          isDragging
            ? "border-copper bg-copper/10"
            : "border-ivory/20 bg-graphite2 hover:border-ivory/35"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-ivory/15 bg-graphite">
          <UploadCloud className="h-6 w-6 text-copper" strokeWidth={1.5} />
        </div>

        <div>
          <p className="font-display text-lg text-ivory">Drop a business card here</p>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-ivory/45">
            JPEG, PNG or WebP · up to 8MB
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2.5 font-body text-sm font-medium text-graphite transition-colors hover:bg-copperdim"
          >
            <ImagePlus className="h-4 w-4" strokeWidth={2} />
            Choose a photo
          </button>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full border border-ivory/25 px-5 py-2.5 font-body text-sm font-medium text-ivory transition-colors hover:border-ivory/50"
          >
            <Camera className="h-4 w-4" strokeWidth={2} />
            Use camera
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    </div>
  );
}
