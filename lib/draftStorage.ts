import type { CardData } from "@/types/card";

const PREFIX = "contact-draft:";

export function getDraft(id: string): Partial<CardData> | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setDraft(id: string, changes: Partial<CardData>): void {
  localStorage.setItem(PREFIX + id, JSON.stringify(changes));
}

export function clearDraft(id: string): void {
  localStorage.removeItem(PREFIX + id);
}

export function getAllDrafts(): Record<string, Partial<CardData>> {
  const drafts: Record<string, Partial<CardData>> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) {
      const id = key.slice(PREFIX.length);
      try {
        drafts[id] = JSON.parse(localStorage.getItem(key) || "{}");
      } catch {
        // skip malformed
      }
    }
  }
  return drafts;
}
