"use client";

/* eslint-disable @next/next/no-img-element */

interface ScannerStageProps {
  imageUrl: string;
  scanning: boolean;
}

export default function ScannerStage({ imageUrl, scanning }: ScannerStageProps) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <img src={imageUrl} alt="Uploaded business card" className="w-full object-contain" />
        {scanning && (
          <>
            <div className="pointer-events-none absolute inset-0 bg-graphite/10" />
            <div
              className="pointer-events-none absolute left-0 right-0 h-[3px] animate-scanline"
              style={{
                background:
                  "linear-gradient(90deg, transparent, #E8A33D 20%, #FBF7EE 50%, #E8A33D 80%, transparent)",
                boxShadow: "0 0 12px 2px rgba(232,163,61,0.7)",
              }}
            />
          </>
        )}
      </div>
      {scanning && (
        <p className="mt-4 text-center font-mono text-xs uppercase tracking-[0.2em] text-sky-600">
          Reading card details…
        </p>
      )}
    </div>
  );
}
