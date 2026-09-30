import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Globe,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from "lucide-react";

import { prisma } from "@/lib/prisma";
import { bareUrl, initials, toHref, whatsappHref } from "@/lib/contact";
import {
  BulletBlock,
  LabelledLinks,
  Linkify,
  SourceLinks,
  extractWhatsApp,
} from "@/components/ProfileRichText";
import ProfileCollectionButtons from "@/components/ProfileCollectionButtons";
import { CopyButton, RefreshWhileRunning, SaveContactButton } from "./ProfileActions";

type Props = { params: Promise<{ id: string }> };

const getContact = (id: string) =>
  prisma.contact.findUnique({ where: { id }, include: { enrichment: true } });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contact = await getContact((await params).id);
  const name = contact?.fullName ?? contact?.company ?? "Contact";
  return { title: `${name} | Cardfile` };
}

const STATUS_NOTE: Record<string, string> = {
  PENDING: "Research is queued. Details will appear here when it finishes.",
  RUNNING: "Researching this contact. This page updates on its own.",
  PARTIAL: "Some public details could not be verified.",
  FAILED: "Research could not find public details for this contact.",
};

const ACTION =
  "flex flex-col items-center gap-1.5 rounded-2xl bg-white px-2 py-3 text-xs font-medium text-ink shadow-soft ring-1 ring-stone-900/[0.04] transition duration-200 ease-spring hover:-translate-y-px hover:shadow-lift active:scale-[.98]";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-stone-500">{title}</h2>
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
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-stone-400">{label}</p>
        {href ? (
          <a
            href={href}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="block truncate text-sm text-ink transition-colors hover:text-accent-700"
          >
            {value}
          </a>
        ) : (
          <p className="text-sm text-ink">{value}</p>
        )}
      </div>
      <CopyButton value={value} label={label.toLowerCase()} />
    </li>
  );
}

export default async function ContactProfilePage({ params }: Props) {
  const contact = await getContact((await params).id);
  if (!contact) notFound();

  const e = contact.enrichment;
  const status = e?.status ?? null;
  const phones = [
    ...contact.mobileNumbers.map((n) => ({ n, label: "Mobile" })),
    ...contact.telephoneNumbers.map((n) => ({ n, label: "Office" })),
  ];
  const primaryPhone = phones[0]?.n;
  const primaryEmail = contact.emails[0];
  const whatsapp = extractWhatsApp(e?.other_profiles)?.url ?? (contact.mobileNumbers[0] ? whatsappHref(contact.mobileNumbers[0]) : null);
  const otherProfiles = extractWhatsApp(e?.other_profiles)?.remaining ?? e?.other_profiles;
  const linkedin = e?.linkedin_url ?? contact.linkedin;
  const website = contact.website ?? e?.official_site;
  const location = e?.location ?? contact.companyLocation ?? contact.address;
  const socials = [
    { label: "Facebook", url: e?.facebook_url },
    { label: "X (Twitter)", url: e?.twitter_url },
    { label: "Instagram", url: e?.instagram_url },
  ].filter((s): s is { label: string; url: string } => !!s.url);

  const hasAbout = !!(e?.summary || e?.career_background);
  const hasCompany = !!(e?.company_core_business || e?.company_details);

  const quickActions = [
    primaryPhone && { label: "Call", href: `tel:${primaryPhone}`, icon: <Phone className="h-5 w-5" strokeWidth={1.75} /> },
    primaryEmail && { label: "Email", href: `mailto:${primaryEmail}`, icon: <Mail className="h-5 w-5" strokeWidth={1.75} /> },
    whatsapp && { label: "WhatsApp", href: whatsapp, external: true, icon: <MessageCircle className="h-5 w-5" strokeWidth={1.75} /> },
    linkedin && { label: "LinkedIn", href: toHref(linkedin), external: true, icon: <Linkedin className="h-5 w-5" strokeWidth={1.75} /> },
    website && { label: "Website", href: toHref(website), external: true, icon: <Globe className="h-5 w-5" strokeWidth={1.75} /> },
  ].filter(Boolean) as { label: string; href: string; external?: boolean; icon: React.ReactNode }[];

  return (
    <main id="main" className="bg-grain min-h-[calc(100dvh-64px)] pb-28 md:pb-16">
      <RefreshWhileRunning active={status === "PENDING" || status === "RUNNING"} />

      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <Link
          href="/"
          className="-ml-2 mt-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-stone-500 transition hover:bg-stone-900/5 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          All contacts
        </Link>

        {/* Identity */}
        <header className="mt-6 flex animate-rise flex-col gap-5 sm:flex-row sm:items-center">
          {e?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={e.avatar_url}
              alt={contact.fullName ?? "Contact photo"}
              className="h-20 w-20 rounded-3xl object-cover shadow-soft"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-20 w-20 items-center justify-center rounded-3xl bg-accent-100 font-display text-3xl font-medium text-accent-800"
            >
              {initials(contact.fullName ?? contact.company) || "?"}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-medium leading-tight tracking-tight text-ink md:text-4xl">
              {contact.fullName ?? contact.company ?? "Unnamed contact"}
            </h1>
            {(contact.jobTitle || (contact.fullName && contact.company)) && (
              <p className="mt-1 text-base text-stone-600">
                {contact.jobTitle}
                {contact.jobTitle && contact.fullName && contact.company ? " at " : ""}
                {contact.fullName && contact.company && (
                  <span className="font-medium text-ink">{contact.company}</span>
                )}
              </p>
            )}
            {location && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-stone-500">
                <MapPin className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {location}
              </p>
            )}
          </div>

          <SaveContactButton
            contact={contact}
            className="hidden shrink-0 items-center gap-2 rounded-xl bg-accent-700 px-4 py-2.5 text-sm font-medium text-white shadow-soft transition duration-200 ease-spring hover:-translate-y-px hover:bg-accent-800 active:scale-[.98] sm:inline-flex"
          />
        </header>

        {/* One-tap actions */}
        {quickActions.length > 0 && (
          <nav
            aria-label="Contact actions"
            className="mt-6 grid animate-rise gap-2 [animation-delay:60ms]"
            style={{ gridTemplateColumns: `repeat(${Math.min(quickActions.length, 5)}, minmax(0, 1fr))` }}
          >
            {quickActions.map((a) => (
              <a
                key={a.label}
                href={a.href}
                {...(a.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={ACTION}
              >
                <span className="text-accent-700">{a.icon}</span>
                {a.label}
              </a>
            ))}
          </nav>
        )}

        {status && STATUS_NOTE[status] && (
          <p
            role="status"
            className={`mt-6 flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm ${
              status === "FAILED" ? "bg-red-50 text-red-800" : status === "PARTIAL" ? "bg-amber-50 text-amber-900" : "bg-accent-50 text-accent-900"
            }`}
          >
            {status === "RUNNING" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent-500" />}
            {STATUS_NOTE[status]}
          </p>
        )}

        <div className="mt-10 grid animate-rise gap-10 [animation-delay:120ms] lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14">
          {/* Story */}
          <div className="space-y-10">
            {hasAbout ? (
              <Section title="About">
                {e?.summary && (
                  <p className="max-w-[65ch] whitespace-pre-wrap text-[15px] leading-relaxed text-stone-700">
                    {e.summary}
                  </p>
                )}
                {e?.career_background && (
                  <div className="mt-5 max-w-[65ch] text-[15px] leading-relaxed text-stone-700">
                    <BulletBlock text={e.career_background} />
                  </div>
                )}
              </Section>
            ) : (
              !status && (
                <Section title="About">
                  <p className="max-w-[55ch] text-[15px] leading-relaxed text-stone-500">
                    Nothing beyond the card yet. Once this contact is researched, a summary and
                    background will show up here.
                  </p>
                </Section>
              )
            )}

            {hasCompany && (
              <Section title={contact.company ? `About ${contact.company}` : "Company"}>
                {e?.company_core_business && (
                  <div className="max-w-[65ch] text-[15px] leading-relaxed text-stone-700">
                    <BulletBlock text={e.company_core_business} />
                  </div>
                )}
                {e?.company_details && (
                  <p className="mt-4 max-w-[65ch] whitespace-pre-wrap text-[15px] leading-relaxed text-stone-700">
                    {e.company_details}
                  </p>
                )}
              </Section>
            )}

            {e?.sources && (
              <details className="group max-w-[65ch] text-sm">
                <summary className="cursor-pointer list-none text-sm font-medium text-stone-500 transition hover:text-ink">
                  <span className="group-open:hidden">Show sources</span>
                  <span className="hidden group-open:inline">Hide sources</span>
                </summary>
                <div className="mt-3 text-stone-600">
                  <SourceLinks text={e.sources} />
                </div>
              </details>
            )}
          </div>

          {/* Reference details */}
          <aside className="space-y-8">
            <Section title="Contact details">
              <ul className="divide-y divide-stone-100 rounded-2xl bg-white px-4 shadow-soft ring-1 ring-stone-900/[0.04]">
                {phones.map((p, i) => (
                  <DetailRow key={`p${i}`} icon={<Phone className="h-4 w-4" strokeWidth={1.75} />} label={p.label} value={p.n} href={`tel:${p.n}`} />
                ))}
                {contact.emails.map((m, i) => (
                  <DetailRow key={`e${i}`} icon={<Mail className="h-4 w-4" strokeWidth={1.75} />} label="Email" value={m} href={`mailto:${m}`} />
                ))}
                {website && (
                  <DetailRow icon={<Globe className="h-4 w-4" strokeWidth={1.75} />} label="Website" value={bareUrl(website)} href={toHref(website)} external />
                )}
                {contact.address && (
                  <DetailRow
                    icon={<MapPin className="h-4 w-4" strokeWidth={1.75} />}
                    label="Address"
                    value={contact.address}
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.address)}`}
                    external
                  />
                )}
                {phones.length + contact.emails.length === 0 && !website && !contact.address && (
                  <li className="py-4 text-sm text-stone-500">No contact details on the card.</li>
                )}
              </ul>
            </Section>

            {(socials.length > 0 || otherProfiles) && (
              <Section title="Elsewhere">
                <ul className="space-y-2 text-sm">
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

            <ProfileCollectionButtons contact={{ ...contact, otherSocials: [] }} compact />
          </aside>
        </div>
      </div>

      {/* Mobile action bar: the two most common actions, always in reach. */}
      <div className="fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-2 gap-2 sm:hidden">
        {primaryPhone ? (
          <a
            href={`tel:${primaryPhone}`}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-medium text-ink shadow-pop ring-1 ring-stone-900/[0.06] active:scale-[.98]"
          >
            <Phone className="h-4 w-4" strokeWidth={1.75} />
            Call
          </a>
        ) : primaryEmail ? (
          <a
            href={`mailto:${primaryEmail}`}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-medium text-ink shadow-pop ring-1 ring-stone-900/[0.06] active:scale-[.98]"
          >
            <Mail className="h-4 w-4" strokeWidth={1.75} />
            Email
          </a>
        ) : (
          <span />
        )}
        <SaveContactButton
          contact={contact}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent-700 py-3 text-sm font-medium text-white shadow-pop active:scale-[.98]"
        />
      </div>
    </main>
  );
}
