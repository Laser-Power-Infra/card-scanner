/**
 * Pure per-contact field cleaning: emails, website, linkedin and mojibake.
 *
 * Extracted from scripts/clean-contact-fields.ts so the same rules run for one
 * contact from the CLI and from the new-entry pipeline. No Prisma, no
 * filesystem, no LLM.
 */

import { repairMojibake } from "./text";
import { repairEmailSpaces, resolveOcrVariants, validateEmail } from "./email";
import { normalizeLinkedin, normalizeWebsite } from "./url";

export interface ContactFieldSource {
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
  address: string | null;
  emails: string[];
  website: string | null;
  linkedin: string | null;
}

export interface ContactFieldData {
  fullName?: string;
  jobTitle?: string;
  company?: string;
  address?: string;
  emails?: string[];
  website?: string;
  linkedin?: string;
}

export interface ContactFieldReview {
  field: string;
  reason: string;
  proposed?: unknown;
}

export interface ContactFieldPlan {
  data: ContactFieldData;
  reviews: ContactFieldReview[];
}

export function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

export function hostOf(value: string | null): string | null {
  if (!value) return null;
  const stripped = value.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0];
  return stripped ? stripped.toLowerCase().replace(/^www\./, "") : null;
}

/** Plan the changes for one row. `domainFrequency` is scoped to this row's domains. */
export function planContactFields(
  contact: ContactFieldSource,
  domainFrequency: Map<string, number>,
): ContactFieldPlan {
  const data: ContactFieldData = {};
  const reviews: ContactFieldReview[] = [];

  // Mojibake in text columns.
  for (const field of ["fullName", "jobTitle", "company", "address"] as const) {
    const raw = contact[field];
    if (!raw) continue;
    const repaired = repairMojibake(raw);
    if (repaired.repaired) {
      data[field] = repaired.value;
    }
  }

  // Emails.
  if (contact.emails.length > 0) {
    const websiteHost = hostOf(contact.website) ?? undefined;
    const rowDomains = contact.emails
      .map(emailDomain)
      .filter((d): d is string => !!d);

    const mapped = contact.emails.map((email) => {
      if (validateEmail(email)) return email;
      const repair = repairEmailSpaces(email, { websiteHost, rowDomains });
      if (!repair) {
        reviews.push({ field: "emails", reason: "invalid_email", proposed: email });
        return email;
      }
      if (repair.confident) {
        return repair.value;
      }
      reviews.push({
        field: "emails",
        reason: "unconfirmed_space_repair",
        proposed: repair.value,
      });
      return email;
    });

    const variant = resolveOcrVariants(mapped, domainFrequency);
    if (variant.review) {
      reviews.push({ field: "emails", reason: "ocr_variant_ambiguous", proposed: mapped });
    }
    if (variant.dropped.length > 0) {
      reviews.push({
        field: "emails",
        reason: "ocr_variant_drop",
        proposed: variant.keep,
      });
    }
    if (
      variant.keep.length !== contact.emails.length ||
      variant.keep.some((e, i) => e !== contact.emails[i])
    ) {
      data.emails = variant.keep;
    }
  }

  // Website.
  if (contact.website) {
    const site = normalizeWebsite(contact.website);
    if (site.valid && site.changed) {
      data.website = site.value;
    }
    const siteHost = hostOf(site.valid ? site.value : contact.website);
    const mailDomain = contact.emails.map(emailDomain).find((d): d is string => !!d) ?? null;
    if (siteHost && mailDomain && siteHost !== mailDomain) {
      reviews.push({
        field: "website",
        reason: "website_email_domain_mismatch",
        proposed: siteHost,
      });
    }
  }

  // LinkedIn.
  if (contact.linkedin) {
    const linked = normalizeLinkedin(contact.linkedin);
    if (linked.confident && linked.value && linked.value !== contact.linkedin) {
      data.linkedin = linked.value;
    } else if (!linked.value) {
      reviews.push({
        field: "linkedin",
        reason: "linkedin_bad_format",
        proposed: contact.linkedin,
      });
    }
  }

  // Address: report only, never rewritten.
  if (contact.address && !/\b\d{6}\b/.test(contact.address)) {
    reviews.push({
      field: "address",
      reason: "address_no_pincode",
      proposed: contact.address,
    });
  }

  return { data, reviews };
}
