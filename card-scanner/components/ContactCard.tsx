import {
  Mail,
  Phone,
  Globe,
  MapPin,
  ChevronDown,
  User,
  Building2,
} from "lucide-react";

import type { CardData } from "@/types/card";

type Props = {
  data: CardData;
};

export default function ContactCard({ data }: Props) {
  const initials =
    data.fullName
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "NA";

  return (
    <div className="overflow-hidden rounded-md border border-[#e6ddd0] bg-white shadow-sm transition-all hover:shadow-md">
      {/* Header */}
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex gap-4">
            {/* Avatar */}
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-lg font-semibold text-slate-700">
              {initials}
            </div>

            <div>
              <h3 className="font-serif text-3xl font-bold text-[#1e1e1e]">
                {data.fullName || "Unknown Contact"}
              </h3>

              <p className="mt-1 text-sm text-gray-700">
                {data.jobTitle || "Professional"}
              </p>

              {data.company && (
                <div className="mt-3 inline-block bg-[#f5ddd4] px-3 py-2 text-xs uppercase tracking-[0.2em] text-[#cf6c4d]">
                  {data.company}
                </div>
              )}
            </div>
          </div>

          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#7ea18b]">
            High
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="border-t border-[#eee7dc] bg-white px-6 py-5">
        <div className="space-y-4">

          {/* Emails */}
          {data.emails?.map((email, index) => (
            <div
              key={`email-${index}`}
              className="flex items-center gap-3"
            >
              <Mail size={16} className="text-gray-500" />
              <span className="text-sm text-gray-800">
                {email}
              </span>
            </div>
          ))}

          {/* Mobile Numbers */}
          {data.mobileNumbers?.map((phone, index) => (
            <div
              key={`mobile-${index}`}
              className="flex items-center gap-3"
            >
              <Phone size={16} className="text-gray-500" />
              <span className="text-sm text-gray-800">
                Mobile: {phone}
              </span>
            </div>
          ))}

          {/* Telephone Numbers */}
          {data.telephoneNumbers?.map((phone, index) => (
            <div
              key={`telephone-${index}`}
              className="flex items-center gap-3"
            >
              <Phone size={16} className="text-gray-500" />
              <span className="text-sm text-gray-800">
                Tel: {phone}
              </span>
            </div>
          ))}

          {/* Website */}
          {data.website && (
            <div className="flex items-center gap-3">
              <Globe size={16} className="text-gray-500" />
              <a
                href={data.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline"
              >
                {data.website}
              </a>
            </div>
          )}

          {/* Address */}
          {data.address && (
            <div className="flex items-center gap-3">
              <MapPin size={16} className="text-gray-500" />
              <span className="text-sm text-gray-800">
                {data.address}
              </span>
            </div>
          )}

          {/* Company Location */}
          {data.companyLocation && (
            <div className="flex items-center gap-3">
              <Building2 size={16} className="text-gray-500" />
              <span className="text-sm text-gray-800">
                {data.companyLocation}
              </span>
            </div>
          )}

          {/* LinkedIn */}
          {data.linkedin && (
            <div className="flex items-center gap-3">
              <Globe size={16} className="text-gray-500" />
              <a
                href={data.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline"
              >
                LinkedIn
              </a>
            </div>
          )}

          {/* Other Socials */}
          {data.otherSocials?.map((social, index) => (
            <div
              key={`social-${index}`}
              className="flex items-center gap-3"
            >
              <Globe size={16} className="text-gray-500" />
              <a
                href={social.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline"
              >
                {social.label}
              </a>
            </div>
          ))}

          {/* Empty State */}
          {!data.address &&
            !data.companyLocation &&
            !data.website &&
            !data.mobileNumbers?.length &&
            !data.telephoneNumbers?.length &&
            !data.emails?.length && (
              <div className="flex items-center gap-3">
                <User size={16} className="text-gray-500" />
                <span className="text-sm text-gray-500">
                  No additional details available
                </span>
              </div>
            )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-[#eee7dc] bg-[#f7f2ea] px-6 py-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#7f6f63]">
          View Full Profile
        </span>

        <ChevronDown
          size={18}
          className="text-[#7f6f63]"
        />
      </div>
    </div>
  );
}