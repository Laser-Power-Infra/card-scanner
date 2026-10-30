import { toast } from "sonner";

import { downloadVCard } from "@/lib/contact";
import type { DuplicateInfo } from "@/lib/store/contactsSlice";
import type { CardData } from "@/types/card";

/** One id for the whole scan lifecycle, so a new scan replaces the old toast
 *  instead of stacking a second one behind it. */
export const SCAN_TOAST_ID = "scan-result";

const NAME_FALLBACK = "Unnamed contact";

export function showScanSuccess(contact: CardData) {
  const name = contact.fullName ?? contact.company ?? NAME_FALLBACK;

  toast.success(name, {
    id: SCAN_TOAST_ID,
    description: "Added to your directory.",
    duration: 8000,
    action: { label: "Save .vcf", onClick: () => downloadVCard(contact) },
  });
}

/** Import summary, or a duplicate/merge notice for a card scan. */
export function showScanNotice(notice: { tone: "success" | "warning"; message: string }) {
  const level = notice.tone === "warning" ? toast.warning : toast.success;

  level(notice.message, {
    id: SCAN_TOAST_ID,
    duration: 10000,
  });
}

export function showScanDuplicate(info: DuplicateInfo) {
  const names = info.details
    .slice(0, 3)
    .map((d) => d.name || d.fullName || "Unknown");
  const extra = info.details.length - names.length;
  const description =
    names.length > 0 ? `${names.join(", ")}${extra > 0 ? ` +${extra} more` : ""}` : undefined;

  toast.warning(info.message, {
    id: SCAN_TOAST_ID,
    description,
    duration: 10000,
  });
}

export function showScanError(message: string, onRetry: () => void) {
  toast.error("Scan failed", {
    id: SCAN_TOAST_ID,
    description: message,
    // A failure worth retrying should not vanish while the user reads it.
    duration: Infinity,
    action: { label: "Try again", onClick: onRetry },
  });
}

export function dismissScanToast() {
  toast.dismiss(SCAN_TOAST_ID);
}
