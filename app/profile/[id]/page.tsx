import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  ExternalLink,
  CheckCircle2,
  Briefcase,
} from "lucide-react";

import { prisma } from "@/lib/prisma";
import type { CardData } from "@/types/card";
import ProfileCollectionButtons from "@/components/ProfileCollectionButtons";
import {
  BulletBlock,
  LabelledLinks,
  Linkify,
  SourceLinks,
  extractWhatsApp,
} from "@/components/ProfileRichText";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-700 border-slate-200",
  RUNNING: "bg-sky-50 text-sky-700 border-sky-200",
  DONE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PARTIAL: "bg-amber-50 text-amber-700 border-amber-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
};

function initials(name: string | null): string {
  return (name ?? "")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-slate-200 py-3 first:border-t-0">
      <p className="text-xs uppercase tracking-[0.15em] text-slate-500">
        {label}
      </p>
      <div className="mt-1 text-sm text-slate-800">{children}</div>
    </div>
  );
}

function LinkField({
  label,
  href,
  children,
}: {
  label: string;
  href?: string | null;
  children: React.ReactNode;
}) {
  return (
    <Field label={label}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800"
        >
          {children}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span className="text-slate-500">Not available</span>
      )}
    </Field>
  );
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: { enrichment: true },
  });

  if (!contact) {
    notFound();
  }

  const enrichment = contact.enrichment;
  const status = enrichment?.status ?? "PENDING";

  const cardData: CardData = {
    id: contact.id,
    fullName: contact.fullName,
    jobTitle: contact.jobTitle,
    company: contact.company,
    mobileNumbers: contact.mobileNumbers,
    telephoneNumbers: contact.telephoneNumbers,
    emails: contact.emails,
    website: contact.website,
    address: contact.address,
    companyLocation: contact.companyLocation,
    linkedin: contact.linkedin,
    otherSocials: [],
    rawNotes: contact.rawNotes,
  };

  const socialLinks = [
    { label: "LinkedIn", url: enrichment?.linkedin_url },
    { label: "Facebook", url: enrichment?.facebook_url },
    { label: "Twitter", url: enrichment?.twitter_url },
    { label: "Instagram", url: enrichment?.instagram_url },
  ].filter((s) => s.url);

  const whatsapp = extractWhatsApp(enrichment?.other_profiles);
  const otherProfiles = whatsapp?.remaining ?? enrichment?.other_profiles;

  return (
    <div className="bg-slate-100 min-h-screen">
      <div className="mx-auto max-w-4xl p-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-sky-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>

        <div className="mt-4 rounded-2xl bg-white shadow-lg overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-sky-700 to-blue-600 p-8 text-white">
            <div className="flex items-center gap-5">
              {enrichment?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={enrichment.avatar_url}
                  alt={contact.fullName ?? "Contact"}
                  className="h-24 w-24 rounded-full border-4 border-white/30 object-cover"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-white/30 bg-white/20 text-3xl font-semibold">
                  {initials(contact.fullName) || "?"}
                </div>
              )}

              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold">
                    {contact.fullName ?? "Unknown"}
                  </h1>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      STATUS_STYLES[status] ?? STATUS_STYLES.PENDING
                    }`}
                  >
                    {status}
                  </span>
                </div>
                <p className="mt-1 text-sky-100">
                  {contact.jobTitle}
                  {contact.jobTitle && contact.company ? " · " : ""}
                  {contact.company}
                </p>
                {contact.companyLocation && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-sky-100">
                    <MapPin className="h-3.5 w-3.5" />
                    {contact.companyLocation}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-8 p-8 md:grid-cols-2">
            {/* Card data */}
            <section className="rounded-xl border border-slate-200 p-5">
              <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
                <CreditCardIcon />
                Card Details
              </h2>

              <Field label="Mobile">
                {contact.mobileNumbers.length > 0 ? (
                  contact.mobileNumbers.map((n, i) => (
                    <p key={`m-${i}`}>{n}</p>
                  ))
                ) : (
                  <span className="text-slate-500">-</span>
                )}
              </Field>

              <Field label="Telephone">
                {contact.telephoneNumbers.length > 0 ? (
                  contact.telephoneNumbers.map((n, i) => (
                    <p key={`t-${i}`}>{n}</p>
                  ))
                ) : (
                  <span className="text-slate-500">-</span>
                )}
              </Field>

              <Field label="Email">
                {contact.emails.length > 0 ? (
                  contact.emails.map((e, i) => (
                    <a
                      key={`e-${i}`}
                      href={`mailto:${e}`}
                      className="block text-sky-600 hover:text-sky-800"
                    >
                      {e}
                    </a>
                  ))
                ) : (
                  <span className="text-slate-500">-</span>
                )}
              </Field>

              <LinkField label="Website" href={contact.website}>
                {contact.website?.replace(/^https?:\/\//, "")}
              </LinkField>

              <LinkField label="LinkedIn (card)" href={contact.linkedin}>
                {contact.linkedin?.replace(/^https?:\/\//, "")}
              </LinkField>

              <Field label="Address">
                {contact.address ? (
                  contact.address
                ) : (
                  <span className="text-slate-500">-</span>
                )}
              </Field>

              {/* <Field label="Added">
                {contact.createdAt.toLocaleDateString()}
              </Field> */}

              {/* {contact.rawNotes && (
                <Field label="Notes">
                  <pre className="whitespace-pre-wrap font-mono text-xs">
                    {contact.rawNotes}
                  </pre>
                </Field>
              )} */}
               <Field label="Company core business">
                {enrichment?.company_core_business ? (
                  <BulletBlock text={enrichment.company_core_business} />
                ) : (
                  <span className="text-slate-500">Not available</span>
                )}
              </Field>
            </section>

            {/* Enriched data */}
            <section className="rounded-xl border border-slate-200 p-5">
              <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
                <SparklesIcon />
                Enriched Profile
              </h2>

              <Field label="Summary">
                {enrichment?.summary ? (
                  <p className="whitespace-pre-wrap">{enrichment.summary}</p>
                ) : (
                  <span className="text-slate-500">Not available</span>
                )}
              </Field>

              <Field label="Location">
                {enrichment?.location ? (
                  enrichment.location
                ) : (
                  <span className="text-slate-500">Not available</span>
                )}
              </Field>

              {socialLinks.length > 0 && (
                <Field label="Social profiles">
                  <ul className="space-y-1">
                    {socialLinks.map((s) => (
                      <li key={s.label}>
                        <a
                          href={s.url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-800"
                        >
                          {s.label}: {s.url!.replace(/^https?:\/\//, "")}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </Field>
              )}

              {whatsapp && (
                <Field label="WhatsApp">
                  <Linkify text={whatsapp.url} />
                </Field>
              )}

              {otherProfiles && (
                <Field label="Other profiles">
                  <LabelledLinks text={otherProfiles} />
                </Field>
              )}

              {/* <Field label="Official site">
                {enrichment?.official_site ? (
                  <a
                    href={enrichment.official_site}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-600 hover:text-sky-800"
                  >
                    {enrichment.official_site.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <span className="text-slate-500">Not available</span>
                )}
              </Field> */}

             

              <Field label="Company details">
                {enrichment?.company_details ? (
                  <p className="whitespace-pre-wrap">{enrichment.company_details}</p>
                ) : (
                  <span className="text-slate-500">Not available</span>
                )}
              </Field>

              <Field label="Career background">
                {enrichment?.career_background ? (
                  <BulletBlock text={enrichment.career_background} />
                ) : (
                  <span className="text-slate-500">Not available</span>
                )}
              </Field>

              {enrichment?.sources && (
                <Field label="Sources">
                  <SourceLinks text={enrichment.sources} />
                </Field>
              )}

              {enrichment?.enriched_at && (
                <Field label="Enriched at">
                  {enrichment.enriched_at.toLocaleString()}
                </Field>
              )}

              {!enrichment && (
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No enrichment yet. Trigger a worker below to start collecting
                  profile data.
                </div>
              )}
            </section>
          </div>

          {/* Worker triggers */}
          <div className="border-t border-slate-200 p-8">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">
              Collect profile from
            </p>
            <div className="mt-3">
              <ProfileCollectionButtons contact={cardData} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreditCardIcon() {
  return <Briefcase className="h-4 w-4 text-sky-600" />;
}

function SparklesIcon() {
  return <CheckCircle2 className="h-4 w-4 text-sky-600" />;
}
