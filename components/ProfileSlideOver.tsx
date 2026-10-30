"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Globe,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  X,
} from "lucide-react";

import { CopyButton } from "@/app/contacts/[id]/ProfileActions";
import ProfileCollectionButtons from "@/components/ProfileCollectionButtons";
import { BulletBlock, LabelledLinks, SourceLinks, extractWhatsApp } from "@/components/ProfileRichText";
import { bareUrl, initials, toHref, whatsappHref } from "@/lib/contact";
import { getDraft, setDraft, clearDraft } from "@/lib/draftStorage";
import { validateContact } from "@/lib/validation";
import type { CardData, ContactProfileResult } from "@/types/card";

const loadProfile = async (id: string): Promise<ContactProfileResult> => {
  const res = await fetch(`/api/contacts/${encodeURIComponent(id)}/profile`, {
    cache: "no-store",
    credentials: "same-origin",
  });

  if (!res.ok) {
    throw new Error(`Profile request failed (${res.status})`);
  }

  return (await res.json()) as ContactProfileResult;
};

interface ProfileSlideOverProps {
  contact: CardData;
  open: boolean;
  editMode: boolean;
  onClose: () => void;
  onSave: (changes: Partial<CardData>) => Promise<void> | void;
}

export const STATUS_NOTE: Record<string, string> = {
  PENDING: "Research is queued. Details will appear here when it finishes.",
  RUNNING: "Researching this contact. This panel updates on its own.",
  PARTIAL: "Some public details could not be verified.",
  FAILED: "Research could not find public details for this contact.",
};

const FIELDS: { key: keyof CardData; label: string; type: string }[] = [
  { key: "fullName", label: "Full Name", type: "text" },
  { key: "jobTitle", label: "Job Title", type: "text" },
  { key: "company", label: "Company", type: "text" },
  { key: "website", label: "Website", type: "text" },
  { key: "address", label: "Address", type: "text" },
  { key: "companyLocation", label: "Location", type: "text" },
  { key: "linkedin", label: "LinkedIn", type: "text" },
];

const QUICK_ACTION =
  "flex flex-col items-center gap-1 rounded-xl bg-white px-1 py-2 text-[11px] font-medium text-ink shadow-soft ring-1 ring-stone-900/[0.04] transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-50 hover:shadow-lift active:scale-[.98]";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({
  icon,
  label,
  value,
  href,
  external,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
  external?: boolean;
}) {
  return (
    <li className="group flex items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-stone-400">{label}</p>
        {href ? (
          <a
            href={href}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="block truncate text-sm text-ink transition-colors hover:text-accent-700"
          >
            {value}
          </a>
        ) : (
          <p className="truncate text-sm text-ink">{value}</p>
        )}
      </div>
      <CopyButton value={value} label={label.toLowerCase()} />
    </li>
  );
}

export default function ProfileSlideOver({
  contact,
  open,
  editMode,
  onClose,
  onSave,
}: ProfileSlideOverProps) {
  const [profile, setProfile] = useState<ContactProfileResult | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Partial<CardData>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // The page passes a fresh arrow for onClose on every render. Keeping the
  // callback in a ref means the focus/scroll-lock effect below depends only on
  // `open`, so it cannot tear down and re-run while the drawer is on screen.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const contactId = contact.id;

  // Fetch the full, session-shaped profile when the drawer opens. The list
  // payload paints the identity immediately; enrichment fills in after.
  useEffect(() => {
    if (!open || !contactId) {
      setProfile(null);
      setLoadingProfile(false);
      return;
    }

    let cancelled = false;
    setLoadingProfile(true);
    setProfileError(null);
    // Never show the previous contact's researched data while the new read is
    // in flight.
    setProfile((prev) => (prev?.contact.id === contactId ? prev : null));
    setDraftState(getDraft(contactId) ?? {});
    setSaveError(null);

    loadProfile(contactId)
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .catch(() => {
        if (!cancelled) setProfileError("Could not load the researched profile.");
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, contactId]);

  // Body scroll lock, ESC, focus trap, and focus restore.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const status = profile?.enrichment?.status ?? contact.enrichment?.status ?? null;

  // Research in progress: poll while the drawer is open, stopping at a terminal
  // status. Server page does the same via router.refresh().
  useEffect(() => {
    if (!open || !contactId) return;
    if (status !== "PENDING" && status !== "RUNNING") return;

    const timer = setInterval(() => {
      loadProfile(contactId)
        .then((result) => setProfile(result))
        .catch(() => {
          // Transient failure: keep the current view, try again next tick.
        });
    }, 10000);

    return () => clearInterval(timer);
  }, [open, contactId, status]);

  if (!open) return null;

  const view = profile?.contact ?? contact;
  const enrichment = profile?.enrichment ?? null;
  const canSeeEnrichment = profile?.canSeeEnrichment ?? false;

  const name = view.fullName ?? view.company ?? "Unnamed contact";
  const phones = [
    ...view.mobileNumbers.map((n) => ({ n, label: "Mobile" })),
    ...view.telephoneNumbers.map((n) => ({ n, label: "Office" })),
  ];
  const primaryPhone = phones[0]?.n;
  const primaryEmail = view.emails[0];
  const whatsapp =
    extractWhatsApp(enrichment?.otherProfiles)?.url ??
    (view.mobileNumbers[0] ? whatsappHref(view.mobileNumbers[0]) : null);
  const otherProfiles = extractWhatsApp(enrichment?.otherProfiles)?.remaining ?? enrichment?.otherProfiles;
  const linkedin = enrichment?.linkedinUrl ?? view.linkedin;
  const website = view.website ?? enrichment?.officialSite;
  const location = enrichment?.location ?? view.companyLocation ?? view.address;
  const socials = [
    { label: "Facebook", url: enrichment?.facebookUrl },
    { label: "X (Twitter)", url: enrichment?.twitterUrl },
    { label: "Instagram", url: enrichment?.instagramUrl },
  ].filter((s): s is { label: string; url: string } => !!s.url);

  const hasAbout = !!(enrichment?.summary || enrichment?.careerBackground);
  const hasCompany = !!(enrichment?.companyCoreBusiness || enrichment?.companyDetails);

  const quickActions = [
    primaryPhone && { label: "Call", href: `tel:${primaryPhone}`, icon: <Phone className="h-4 w-4" strokeWidth={1.75} /> },
    primaryEmail && { label: "Email", href: `mailto:${primaryEmail}`, icon: <Mail className="h-4 w-4" strokeWidth={1.75} /> },
    whatsapp && { label: "WhatsApp", href: whatsapp, external: true, icon: <MessageCircle className="h-4 w-4" strokeWidth={1.75} /> },
    linkedin && { label: "LinkedIn", href: toHref(linkedin), external: true, icon: <Linkedin className="h-4 w-4" strokeWidth={1.75} /> },
    website && { label: "Website", href: toHref(website), external: true, icon: <Globe className="h-4 w-4" strokeWidth={1.75} /> },
  ].filter(Boolean) as { label: string; href: string; external?: boolean; icon: React.ReactNode }[];

  const handleFieldChange = (field: keyof CardData, value: string) => {
    if (!contactId) return;
    const existing = getDraft(contactId) ?? {};
    const updated = { ...existing, [field]: value };
    setDraft(contactId, updated);
    setDraftState(updated);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!contactId) return;
    const currentDraft = getDraft(contactId) ?? {};
    const error = validateContact(currentDraft);
    if (error) {
      setSaveError(error);
      return;
    }

    setSaving(true);
    try {
      await onSave(currentDraft);
      setDraftState({});
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : typeof err === "string" ? err : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (!contactId) return;
    clearDraft(contactId);
    setDraftState({});
    setSaveError(null);
  };

  // The bucket is cross-origin, so the `download` attribute is ignored on a
  // plain link. Fetch to a blob to force the filename; fall back to opening the
  // raw public URL if the fetch fails.
  const handleDownload = async (imageUrl: string, suffix = "") => {
    if (!imageUrl) return;

    const ext = imageUrl.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? "img";

    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error("download failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}${suffix}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(imageUrl, "_blank", "noopener,noreferrer");
    }
  };

  const hasDraft = Object.keys(draft).length > 0;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 animate-[fade_0.2s_ease-out_both] bg-ink/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-drawer-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-md animate-[slide-in_0.32s_cubic-bezier(0.2,0.8,0.2,1)_both] flex-col bg-white shadow-pop"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 bg-white/95 px-3 py-2.5 backdrop-blur">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-stone-500 transition hover:bg-stone-900/5 hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            Back
          </button>

          <span
            id="contact-drawer-title"
            className="min-w-0 flex-1 truncate text-center font-display text-base font-medium text-ink"
          >
            {name}
          </span>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="shrink-0 rounded-lg p-1.5 text-stone-500 transition hover:bg-stone-100 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-7 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
            {/* Identity */}
            <header className="flex items-center gap-3">
              {enrichment?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={enrichment.avatarUrl}
                  alt={name}
                  className="h-14 w-14 rounded-2xl object-cover shadow-soft"
                />
              ) : (
                <div
                  aria-hidden
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-100 font-display text-xl font-medium text-accent-800"
                >
                  {initials(view.fullName ?? view.company) || "?"}
                </div>
              )}

              <div className="min-w-0 flex-1">
                {view.jobTitle && (
                  <p className="text-sm text-stone-600">{view.jobTitle}</p>
                )}
                {view.fullName && view.company && (
                  <p className="text-sm font-medium text-ink">{view.company}</p>
                )}
                {location && (
                  <p className="mt-1 inline-flex items-start gap-1 text-xs text-stone-500">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    <span className="line-clamp-2">{location}</span>
                  </p>
                )}
              </div>
            </header>

            {/* Quick actions */}
            {quickActions.length > 0 && (
              <nav
                aria-label="Contact actions"
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${Math.min(quickActions.length, 5)}, minmax(0, 1fr))` }}
              >
                {quickActions.map((a) => (
                  <a
                    key={a.label}
                    href={a.href}
                    {...(a.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className={QUICK_ACTION}
                  >
                    <span className="text-accent-700">{a.icon}</span>
                    {a.label}
                  </a>
                ))}
              </nav>
            )}

            {canSeeEnrichment && status && STATUS_NOTE[status] && (
              <p
                role="status"
                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs ${
                  status === "FAILED"
                    ? "bg-red-50 text-red-800"
                    : status === "PARTIAL"
                      ? "bg-amber-50 text-amber-900"
                      : "bg-accent-50 text-accent-900"
                }`}
              >
                {status === "RUNNING" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent-500" />}
                {STATUS_NOTE[status]}
              </p>
            )}

            {profileError && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{profileError}</p>
            )}

            {loadingProfile && !profile && (
              <div className="space-y-2" aria-hidden>
                <div className="skeleton h-3 w-2/3" />
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-5/6" />
              </div>
            )}

            {/* Contact details */}
            <Section title="Contact details">
              <ul className="divide-y divide-stone-100 rounded-2xl bg-white px-3 shadow-soft ring-1 ring-stone-900/[0.04]">
                {phones.map((p, i) => (
                  <DetailRow
                    key={`p${i}`}
                    icon={<Phone className="h-4 w-4" strokeWidth={1.75} />}
                    label={p.label}
                    value={p.n}
                    href={`tel:${p.n}`}
                  />
                ))}
                {view.emails.map((m, i) => (
                  <DetailRow
                    key={`e${i}`}
                    icon={<Mail className="h-4 w-4" strokeWidth={1.75} />}
                    label="Email"
                    value={m}
                    href={`mailto:${m}`}
                  />
                ))}
                {website && (
                  <DetailRow
                    icon={<Globe className="h-4 w-4" strokeWidth={1.75} />}
                    label="Website"
                    value={bareUrl(website)}
                    href={toHref(website)}
                    external
                  />
                )}
                {view.address && (
                  <DetailRow
                    icon={<MapPin className="h-4 w-4" strokeWidth={1.75} />}
                    label="Address"
                    value={view.address}
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(view.address)}`}
                    external
                  />
                )}
                {phones.length + view.emails.length === 0 && !website && !view.address && (
                  <li className="py-4 text-sm text-stone-500">No contact details on the card.</li>
                )}
              </ul>
            </Section>

            {/* About */}
            {canSeeEnrichment && hasAbout && (
              <Section title="About">
                {enrichment?.summary && (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
                    {enrichment.summary}
                  </p>
                )}
                {enrichment?.careerBackground && (
                  <div className="mt-3 text-sm leading-relaxed text-stone-700">
                    <BulletBlock text={enrichment.careerBackground} />
                  </div>
                )}
              </Section>
            )}

            {/* Company */}
            {canSeeEnrichment && hasCompany && (
              <Section title={view.company ? `About ${view.company}` : "Company"}>
                {enrichment?.companyCoreBusiness && (
                  <div className="text-sm leading-relaxed text-stone-700">
                    <BulletBlock text={enrichment.companyCoreBusiness} />
                  </div>
                )}
                {enrichment?.companyDetails && (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
                    {enrichment.companyDetails}
                  </p>
                )}
              </Section>
            )}

            {/* Elsewhere */}
            {canSeeEnrichment && (socials.length > 0 || otherProfiles) && (
              <Section title="Elsewhere">
                <ul className="space-y-1.5 text-sm">
                  {socials.map((s) => (
                    <li key={s.label}>
                      <a
                        href={toHref(s.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-700 transition hover:text-accent-900 hover:underline hover:underline-offset-2"
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
                {otherProfiles && (
                  <div className="mt-2 text-sm">
                    <LabelledLinks text={otherProfiles} />
                  </div>
                )}
              </Section>
            )}

            {/* Sources */}
            {canSeeEnrichment && enrichment?.sources && (
              <details className="group text-sm">
                <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-wide text-stone-400 transition hover:text-ink">
                  <span className="group-open:hidden">Show sources</span>
                  <span className="hidden group-open:inline">Hide sources</span>
                </summary>
                <div className="mt-2 text-stone-600">
                  <SourceLinks text={enrichment.sources} />
                </div>
              </details>
            )}

            {/* Card images */}
            {(view.originalImageUrl || view.originalBackImageUrl) && (
              <Section title="Card images">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    { url: view.originalImageUrl, label: "Front", suffix: "" },
                    { url: view.originalBackImageUrl, label: "Back", suffix: "-back" },
                  ]
                    .filter((image): image is { url: string; label: string; suffix: string } => !!image.url)
                    .map((image) => (
                      <div key={image.label}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.url}
                          alt={`${image.label} of the business card for ${name}`}
                          className="max-h-64 w-full rounded-xl border border-stone-200 bg-stone-50 object-contain"
                        />
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-stone-400">
                            {image.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDownload(image.url, image.suffix)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </Section>
            )}

            {/* Edit mode */}
            {editMode && (
              <Section title="Edit details">
                <div className="space-y-3">
                  {FIELDS.map(({ key, label, type }) => (
                    <div key={key}>
                      <label className="mb-1 block text-xs font-medium text-stone-500">{label}</label>
                      <input
                        type={type}
                        value={draft[key] !== undefined ? String(draft[key]) : String(view[key] ?? "")}
                        onChange={(e) => handleFieldChange(key, e.target.value)}
                        className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                  ))}

                  <div>
                    <label className="mb-1 block text-xs font-medium text-stone-500">Emails</label>
                    <div className="space-y-2">
                      {(draft.emails ?? view.emails ?? []).map((email, i) => (
                        <input
                          key={i}
                          value={email}
                          onChange={(e) => {
                            const next = [...(draft.emails ?? view.emails ?? [])];
                            next[i] = e.target.value;
                            handleFieldChange("emails", next as unknown as string);
                          }}
                          className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...(draft.emails ?? view.emails ?? []), ""];
                          handleFieldChange("emails", next as unknown as string);
                        }}
                        className="text-xs text-accent-600 hover:underline"
                      >
                        + Add email
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-stone-500">Mobile numbers</label>
                    <div className="space-y-2">
                      {(draft.mobileNumbers ?? view.mobileNumbers ?? []).map((num, i) => (
                        <input
                          key={i}
                          value={num}
                          onChange={(e) => {
                            const next = [...(draft.mobileNumbers ?? view.mobileNumbers ?? [])];
                            next[i] = e.target.value;
                            handleFieldChange("mobileNumbers", next as unknown as string);
                          }}
                          className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...(draft.mobileNumbers ?? view.mobileNumbers ?? []), ""];
                          handleFieldChange("mobileNumbers", next as unknown as string);
                        }}
                        className="text-xs text-accent-600 hover:underline"
                      >
                        + Add number
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-stone-500">Telephone numbers</label>
                    <div className="space-y-2">
                      {(draft.telephoneNumbers ?? view.telephoneNumbers ?? []).map((num, i) => (
                        <input
                          key={i}
                          value={num}
                          onChange={(e) => {
                            const next = [...(draft.telephoneNumbers ?? view.telephoneNumbers ?? [])];
                            next[i] = e.target.value;
                            handleFieldChange("telephoneNumbers", next as unknown as string);
                          }}
                          className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...(draft.telephoneNumbers ?? view.telephoneNumbers ?? []), ""];
                          handleFieldChange("telephoneNumbers", next as unknown as string);
                        }}
                        className="text-xs text-accent-600 hover:underline"
                      >
                        + Add number
                      </button>
                    </div>
                  </div>

                  {hasDraft && (
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Unsaved changes
                    </div>
                  )}

                  {saveError && (
                    <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{saveError}</div>
                  )}

                  {hasDraft && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 rounded-lg bg-accent-700 px-4 py-2 text-sm font-medium text-white hover:bg-accent-800 disabled:opacity-40"
                      >
                        {saving ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancel}
                        className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </Section>
            )}

            <ProfileCollectionButtons contact={{ ...view, otherSocials: [] }} compact />
          </div>
        </div>
      </div>
    </div>
  );
}
