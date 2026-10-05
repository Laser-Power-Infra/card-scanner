// scripts/clean-contact-fields.ts
//
// Cleans the Contact fields no other script owns: emails, website, linkedin,
// and mojibake in any text column. Address is reported but never rewritten.
//
//   - emails: only a CONFIRMED space repair or a STRICT OCR-variant drop is
//     auto-applied; everything else is written to the review file.
//   - website: host case lowercased / spaces stripped when valid. A domain that
//     disagrees with the email domain is review-only.
//   - linkedin: `/in/<slug>` rewrite when confident.
//   - mojibake: deterministic UTF-8 -> Latin-1 round-trip only (no LLM).
//
// Flags: --dry-run
//
// Run: npx tsx scripts/clean-contact-fields.ts [--dry-run]

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ScriptAudit, isDryRun } from "./scriptAudit";
import { writeSnapshot } from "./scriptSnapshot";
import { repairMojibake } from "./cleaning/text";
import { repairEmailSpaces, resolveOcrVariants, validateEmail } from "./cleaning/email";
import { normalizeLinkedin, normalizeWebsite } from "./cleaning/url";

const DRY_RUN = isDryRun();
const audit = new ScriptAudit("clean-contact-fields", DRY_RUN);
const BATCH = 50;
const TX_TIMEOUT = 60000;

function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  const stripped = value.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0];
  return stripped ? stripped.toLowerCase().replace(/^www\./, "") : null;
}

interface Planned {
  id: string;
  data: {
    fullName?: string;
    jobTitle?: string;
    company?: string;
    address?: string;
    emails?: string[];
    website?: string;
    linkedin?: string;
  };
}

async function main() {
  const contacts = await prisma.contact.findMany({
    select: {
      id: true,
      fullName: true,
      jobTitle: true,
      company: true,
      address: true,
      emails: true,
      website: true,
      linkedin: true,
    },
  });
  console.log(`Loaded ${contacts.length} rows.${DRY_RUN ? " (dry run)" : ""}`);

  const domainFrequency = new Map<string, number>();
  for (const contact of contacts) {
    for (const email of contact.emails) {
      const domain = emailDomain(email);
      if (domain) domainFrequency.set(domain, (domainFrequency.get(domain) ?? 0) + 1);
    }
  }

  const planned: Planned[] = [];
  const snapshotRows: Record<string, unknown>[] = [];
  let mojibakeFixed = 0;
  let emailsFixed = 0;
  let sitesFixed = 0;
  let linkedinFixed = 0;

  for (const contact of contacts) {
    const data: Planned["data"] = {};

    // Mojibake in text columns.
    for (const field of ["fullName", "jobTitle", "company", "address"] as const) {
      const raw = contact[field];
      if (!raw) continue;
      const repaired = repairMojibake(raw);
      if (repaired.repaired) {
        data[field] = repaired.value;
        mojibakeFixed++;
        audit.record(contact.id, field, raw, repaired.value, { reason: "mojibake" });
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
          audit.review(contact.id, "emails", { reason: "invalid_email", proposed: email });
          return email;
        }
        if (repair.confident) {
          audit.record(contact.id, "emails", email, repair.value, { reason: "space_repair" });
          return repair.value;
        }
        audit.review(contact.id, "emails", {
          reason: "unconfirmed_space_repair",
          proposed: repair.value,
        });
        return email;
      });

      const variant = resolveOcrVariants(mapped, domainFrequency);
      if (variant.review) {
        audit.review(contact.id, "emails", { reason: "ocr_variant_ambiguous", proposed: mapped });
      }
      if (variant.dropped.length > 0) {
        audit.record(contact.id, "emails", contact.emails, variant.keep, {
          reason: "ocr_variant_drop",
          dropped: variant.dropped,
        });
      }
      if (
        variant.keep.length !== contact.emails.length ||
        variant.keep.some((e, i) => e !== contact.emails[i])
      ) {
        data.emails = variant.keep;
        emailsFixed++;
      }
    }

    // Website.
    if (contact.website) {
      const site = normalizeWebsite(contact.website);
      if (site.valid && site.changed) {
        data.website = site.value;
        sitesFixed++;
        audit.record(contact.id, "website", contact.website, site.value, { reason: "normalize" });
      }
      const siteHost = hostOf(site.valid ? site.value : contact.website);
      const mailDomain = contact.emails.map(emailDomain).find((d): d is string => !!d) ?? null;
      if (siteHost && mailDomain && siteHost !== mailDomain) {
        audit.review(contact.id, "website", {
          reason: "website_email_domain_mismatch",
          proposed: siteHost,
          source: mailDomain,
        });
      }
    }

    // LinkedIn.
    if (contact.linkedin) {
      const linked = normalizeLinkedin(contact.linkedin);
      if (linked.confident && linked.value && linked.value !== contact.linkedin) {
        data.linkedin = linked.value;
        linkedinFixed++;
        audit.record(contact.id, "linkedin", contact.linkedin, linked.value, {
          reason: "normalize",
        });
      } else if (!linked.value) {
        audit.review(contact.id, "linkedin", {
          reason: "linkedin_bad_format",
          proposed: contact.linkedin,
        });
      }
    }

    // Address: report only, never written.
    if (contact.address && !/\b\d{6}\b/.test(contact.address)) {
      audit.review(contact.id, "address", { reason: "address_no_pincode", proposed: contact.address });
    }

    if (Object.keys(data).length > 0) {
      planned.push({ id: contact.id, data });
      snapshotRows.push({
        id: contact.id,
        fullName: contact.fullName,
        jobTitle: contact.jobTitle,
        company: contact.company,
        address: contact.address,
        emails: contact.emails,
        website: contact.website,
        linkedin: contact.linkedin,
      });
    }
  }

  if (!DRY_RUN && planned.length > 0) {
    const file = writeSnapshot("clean-contact-fields", snapshotRows);
    console.log(`Snapshot written to ${file} (${snapshotRows.length} rows)`);
  }

  let applied = 0;
  for (let i = 0; i < planned.length && !DRY_RUN; i += BATCH) {
    const batch = planned.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((change) =>
        prisma.contact.update({ where: { id: change.id }, data: change.data }),
      ),
      { maxWait: TX_TIMEOUT, timeout: TX_TIMEOUT },
    );
    applied += batch.length;
    console.log(`Applied ${applied}/${planned.length}`);
  }

  const summary =
    `Rows loaded: ${contacts.length}. Changed: ${planned.length}, applied: ${applied}. ` +
    `Mojibake fixed: ${mojibakeFixed}. Emails updated: ${emailsFixed}. ` +
    `Websites normalized: ${sitesFixed}. LinkedIn normalized: ${linkedinFixed}.`;
  console.log(summary);
  if (DRY_RUN) console.log("Dry run - no database writes were made.");
  audit.logRun(summary);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    audit.write();
    prisma.$disconnect();
  });
