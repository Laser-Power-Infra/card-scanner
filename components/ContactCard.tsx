"use client";

import {
  Building2,
  Globe,
  Linkedin,
  Mail,
  MapPin,
  Phone,
  StickyNote,
  Link2,
} from "lucide-react";

import type { CardData } from "@/types/card";

interface ContactCardProps {
  data: CardData;
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-t border-slate-200 py-3 first:border-t-0">
      <div className="mt-0.5 text-sky-700">{icon}</div>

      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">
          {label}
        </p>

        <div className="mt-0.5 break-words font-body text-sm text-slate-900">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function ContactCard({
  data,
}: ContactCardProps) {
  const hasAny =
    data.fullName ||
    data.company ||
    (data.mobileNumbers?.length ?? 0) > 0 ||
    (data.telephoneNumbers?.length ?? 0) > 0 ||
    (data.emails?.length ?? 0) > 0 ||
    data.website ||
    data.address ||
    data.companyLocation ||
    data.linkedin ||
    (data.otherSocials?.length ?? 0) > 0 ||
    data.rawNotes;

  return (
    <div
      className="mx-auto w-full max-w-md animate-flipin rounded-xl bg-white p-6 shadow-xl ring-1 ring-slate-200"
      style={{
        perspective: "1000px",
        transformStyle: "preserve-3d",
      }}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl italic text-ink">
          {data.fullName ?? "Name not found"}
        </h2>
      </div>

      {(data.jobTitle || data.company) && (
        <p className="font-body text-sm text-ink/70">
          {data.jobTitle}
          {data.jobTitle && data.company ? " · " : ""}
          {data.company}
        </p>
      )}

      <div className="mt-4">

        {/* Mobile Numbers */}
        {data.mobileNumbers?.map((phone, i) => (
          <Field
            key={`mobile-${i}`}
            icon={<Phone className="h-4 w-4" />}
            label="Mobile"
          >
            <a
              href={`tel:${phone}`}
              className="hover:text-sky-700"
            >
              {phone}
            </a>
          </Field>
        ))}

        {/* Telephone Numbers */}
        {data.telephoneNumbers?.map((phone, i) => (
          <Field
            key={`telephone-${i}`}
            icon={<Phone className="h-4 w-4" />}
            label="Telephone"
          >
            <a
              href={`tel:${phone}`}
              className="hover:text-sky-700"
            >
              {phone}
            </a>
          </Field>
        ))}

        {/* Emails */}
        {data.emails?.map((email, i) => (
          <Field
            key={`email-${i}`}
            icon={<Mail className="h-4 w-4" />}
            label="Email"
          >
            <a
              href={`mailto:${email}`}
              className="hover:text-sky-700"
            >
              {email}
            </a>
          </Field>
        ))}

        {/* Website */}
        {data.website && (
          <Field
            icon={<Globe className="h-4 w-4" />}
            label="Website"
          >
            <a
              href={data.website}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-sky-700"
            >
              {data.website.replace(/^https?:\/\//, "")}
            </a>
          </Field>
        )}

        {/* LinkedIn */}
        {data.linkedin && (
          <Field
            icon={<Linkedin className="h-4 w-4" />}
            label="LinkedIn"
          >
            <a
              href={data.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-sky-700"
            >
              {data.linkedin.replace(/^https?:\/\//, "")}
            </a>
          </Field>
        )}

        {/* Other Social Links */}
        {data.otherSocials?.map((social, i) => (
          <Field
            key={`social-${i}`}
            icon={<Link2 className="h-4 w-4" />}
            label={social.label}
          >
            <a
              href={social.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-sky-700"
            >
              {social.url.replace(/^https?:\/\//, "")}
            </a>
          </Field>
        ))}

        {/* Address */}
        {data.address && (
          <Field
            icon={<MapPin className="h-4 w-4" />}
            label="Address"
          >
            {data.address}
          </Field>
        )}

        {/* Company Location */}
        {data.companyLocation && (
          <Field
            icon={<MapPin className="h-4 w-4" />}
            label="Company Location"
          >
            {data.companyLocation}
          </Field>
        )}

        {/* Company */}
        {data.company && !data.jobTitle && (
          <Field
            icon={<Building2 className="h-4 w-4" />}
            label="Company"
          >
            {data.company}
          </Field>
        )}

        {/* Notes */}
        {data.rawNotes && (
          <Field
            icon={<StickyNote className="h-4 w-4" />}
            label="Notes"
          >
            {data.rawNotes}
          </Field>
        )}

        {!hasAny && (
          <p className="py-4 text-center font-body text-sm text-ink/60">
            No readable details were found on this card.
            Try a clearer, well-lit photo.
          </p>
        )}
      </div>
    </div>
  );
}