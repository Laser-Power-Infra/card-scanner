"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download } from "lucide-react";

import { downloadVCard } from "@/lib/contact";

type VCardContact = Parameters<typeof downloadVCard>[0];

export function SaveContactButton({ contact, className }: { contact: VCardContact; className?: string }) {
  return (
    <button type="button" onClick={() => downloadVCard(contact)} className={className}>
      <Download className="h-4 w-4" strokeWidth={1.75} />
      Save contact
    </button>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true))}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? "Copied" : "Copy"}
      className="shrink-0 rounded-lg p-1.5 text-stone-400 opacity-100 transition hover:bg-stone-900/5 hover:text-ink focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
    >
      {copied ? (
        <Check className="h-4 w-4 text-accent-600" strokeWidth={2} />
      ) : (
        <Copy className="h-4 w-4" strokeWidth={1.75} />
      )}
    </button>
  );
}

/** Re-fetches the server page while research is still in progress. */
export function RefreshWhileRunning({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
