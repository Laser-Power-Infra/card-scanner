"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { CardData } from "@/types/card";
import { getDraft, setDraft, clearDraft } from "@/lib/draftStorage";
import { validateContact } from "@/lib/validation";

interface ProfileSlideOverProps {
  contact: CardData;
  open: boolean;
  editMode: boolean;
  onClose: () => void;
  onSave: () => void;
}

const FIELDS: { key: keyof CardData; label: string; type: string }[] = [
  { key: "fullName", label: "Full Name", type: "text" },
  { key: "jobTitle", label: "Job Title", type: "text" },
  { key: "company", label: "Company", type: "text" },
  { key: "website", label: "Website", type: "text" },
  { key: "address", label: "Address", type: "text" },
  { key: "companyLocation", label: "Location", type: "text" },
  { key: "linkedin", label: "LinkedIn", type: "text" },
];

export default function ProfileSlideOver({
  contact,
  open,
  editMode,
  onClose,
  onSave,
}: ProfileSlideOverProps) {
  const [draft, setDraftState] = useState<Partial<CardData>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && contact.id) {
      setDraftState(getDraft(contact.id) ?? {});
      setError(null);
    }
  }, [open, contact.id]);

  if (!open) return null;

  const handleFieldChange = (field: keyof CardData, value: string) => {
    if (!contact.id) return;
    const existing = getDraft(contact.id) ?? {};
    const updated = { ...existing, [field]: value };
    setDraft(contact.id, updated);
    setDraftState(updated);
    setError(null);
  };

  const handleSave = async () => {
    if (!contact.id) return;
    const currentDraft = getDraft(contact.id) ?? {};
    const error = validateContact(currentDraft);
    if (error) {
      setError(error);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: currentDraft }),
      });

      if (res.ok) {
        clearDraft(contact.id);
        setDraftState({});
        setError(null);
        onSave();
      } else {
        const data = await res.json();
        setError(data.error ?? "Save failed");
      }
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (!contact.id) return;
    clearDraft(contact.id);
    setDraftState({});
    setError(null);
  };

  const hasDraft = Object.keys(draft).length > 0;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
          <h2 className="font-display text-lg font-medium text-ink">Contact</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {FIELDS.map(({ key, label, type }) => {
            const draftValue = draft[key];
            const displayValue = draftValue !== undefined
              ? String(draftValue)
              : String(contact[key] ?? "");

            return (
              <div key={key}>
                <label className="mb-1 block text-xs font-medium text-stone-500">
                  {label}
                </label>
                {editMode ? (
                  <input
                    type={type}
                    value={displayValue}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                  />
                ) : (
                  <p className="text-sm text-ink">
                    {displayValue || <span className="text-stone-400">—</span>}
                  </p>
                )}
              </div>
            );
          })}

          {/* Emails */}
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">
              Emails
            </label>
            {editMode ? (
              <div className="space-y-2">
                {(draft.emails ?? contact.emails ?? []).map((email, i) => (
                  <input
                    key={i}
                    value={email}
                    onChange={(e) => {
                      const newEmails = [...(draft.emails ?? contact.emails ?? [])];
                      newEmails[i] = e.target.value;
                      handleFieldChange("emails", newEmails as unknown as string);
                    }}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                  />
                ))}
                <button
                  onClick={() => {
                    const newEmails = [...(draft.emails ?? contact.emails ?? []), ""];
                    handleFieldChange("emails", newEmails as unknown as string);
                  }}
                  className="text-xs text-accent-600 hover:underline"
                >
                  + Add email
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {(contact.emails ?? []).map((email, i) => (
                  <p key={i} className="text-sm text-ink">{email}</p>
                ))}
                {(contact.emails ?? []).length === 0 && (
                  <p className="text-sm text-stone-400">—</p>
                )}
              </div>
            )}
          </div>

          {/* Mobile Numbers */}
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">
              Mobile Numbers
            </label>
            {editMode ? (
              <div className="space-y-2">
                {(draft.mobileNumbers ?? contact.mobileNumbers ?? []).map((num, i) => (
                  <input
                    key={i}
                    value={num}
                    onChange={(e) => {
                      const newNums = [...(draft.mobileNumbers ?? contact.mobileNumbers ?? [])];
                      newNums[i] = e.target.value;
                      handleFieldChange("mobileNumbers", newNums as unknown as string);
                    }}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                  />
                ))}
                <button
                  onClick={() => {
                    const newNums = [...(draft.mobileNumbers ?? contact.mobileNumbers ?? []), ""];
                    handleFieldChange("mobileNumbers", newNums as unknown as string);
                  }}
                  className="text-xs text-accent-600 hover:underline"
                >
                  + Add number
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {(contact.mobileNumbers ?? []).map((num, i) => (
                  <p key={i} className="text-sm text-ink">{num}</p>
                ))}
                {(contact.mobileNumbers ?? []).length === 0 && (
                  <p className="text-sm text-stone-400">—</p>
                )}
              </div>
            )}
          </div>

          {/* Telephone Numbers */}
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">
              Telephone Numbers
            </label>
            {editMode ? (
              <div className="space-y-2">
                {(draft.telephoneNumbers ?? contact.telephoneNumbers ?? []).map((num, i) => (
                  <input
                    key={i}
                    value={num}
                    onChange={(e) => {
                      const newNums = [...(draft.telephoneNumbers ?? contact.telephoneNumbers ?? [])];
                      newNums[i] = e.target.value;
                      handleFieldChange("telephoneNumbers", newNums as unknown as string);
                    }}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                  />
                ))}
                <button
                  onClick={() => {
                    const newNums = [...(draft.telephoneNumbers ?? contact.telephoneNumbers ?? []), ""];
                    handleFieldChange("telephoneNumbers", newNums as unknown as string);
                  }}
                  className="text-xs text-accent-600 hover:underline"
                >
                  + Add number
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {(contact.telephoneNumbers ?? []).map((num, i) => (
                  <p key={i} className="text-sm text-ink">{num}</p>
                ))}
                {(contact.telephoneNumbers ?? []).length === 0 && (
                  <p className="text-sm text-stone-400">—</p>
                )}
              </div>
            )}
          </div>

          {editMode && hasDraft && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Unsaved changes
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          )}

          {editMode && hasDraft && (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-lg bg-accent-700 px-4 py-2 text-sm font-medium text-white hover:bg-accent-800 disabled:opacity-40"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={handleCancel}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
