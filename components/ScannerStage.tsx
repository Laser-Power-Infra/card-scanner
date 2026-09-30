"use client";

/* eslint-disable @next/next/no-img-element */

interface ScannerStageProps {
  imageUrl: string;
  scanning: boolean;
}

export default function ScannerStage({ imageUrl, scanning }: ScannerStageProps) {
  return (
    <div className="mx-auto mb-6 w-full max-w-md animate-rise">
      <div className="relative overflow-hidden rounded-2xl bg-white p-2 shadow-pop">
        <div className="relative overflow-hidden rounded-xl">
          <img src={imageUrl} alt="Uploaded business card" className="w-full object-contain" />
          {scanning && (
            <>
              <div className="pointer-events-none absolute inset-0 bg-ink/5" />
              <div className="pointer-events-none absolute inset-0 animate-scanline">
                <div
                  className="h-[2px] w-full"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, #6B9985 20%, #F0F5F2 50%, #6B9985 80%, transparent)",
                    boxShadow: "0 0 14px 3px rgba(67,122,101,0.45)",
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>
      {scanning && (
        <p
          role="status"
          className="mt-4 flex items-center justify-center gap-2 text-sm text-stone-600"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500" />
          Reading card details…
        </p>
      )}
    </div>
  );
}
