/**
 * Rule catalog for the DB cleanup checks.
 *
 * `detectFlags` is pure and deterministic. It mirrors the rule IDs in
 * `db/flagged-entries.csv` (the profiled baseline), so
 * `scripts/post-cleanup-checks.ts` can compare live counts against the baseline
 * and against the post-cleanup target.
 *
 * No Prisma, no network: cross-row rules are fed through `FlagsContext` by the
 * caller.
 */

import { INDIAN_STATES } from "../../lib/location";
import { parsePhone, splitConcatenated } from "./phone";
import { norm, repairMojibake, stripSourceTag, stripHonorifics } from "./text";
import { companyIsPersonName, isBareCity } from "./company";
import { extractQualifications, isNotARole } from "./job";
import { resolveOcrVariants, validateEmail } from "./email";
import { normalizeLinkedin, normalizeWebsite } from "./url";
import { canonicalState } from "./locationFix";
import { parseComposite } from "./composite";

export type Severity = "high" | "medium" | "low" | "info";

/** Rule -> severity, sourced from db/flagged-entries.csv. */
export const RULE_SEVERITY = {
  ADDRESS_NO_PINCODE: "low",
  ADDRESS_NOT_INDIAN_FORMAT: "medium",
  COMPANY_DASH_JUNK: "high",
  COMPANY_DOUBLE_SPACE: "low",
  COMPANY_HAS_ADDRESS: "medium",
  COMPANY_HAS_URL_PHONE: "high",
  COMPANY_IS_CITY: "medium",
  COMPANY_IS_JOB_TITLE: "high",
  COMPANY_IS_PERSON_NAME: "high",
  COMPANY_MULTI_CANDIDATE: "medium",
  COMPANY_OCR_GARBAGE: "high",
  COMPANY_PLACEHOLDER: "high",
  COMPANY_SHORT_CODE: "info",
  COMPANY_SOURCE_TAG: "high",
  DUP_SAME_NAME: "medium",
  DUP_SHARED_PHONE: "info",
  EMAIL_INVALID: "high",
  EMAIL_OCR_VARIANT_PAIR: "medium",
  ENR_COUNTERS_UNSET: "info",
  ENR_DONE_BUT_UNVERIFIED: "high",
  ENR_ENRICHED_AT_NULL: "info",
  ENR_NO_LINKEDIN: "info",
  ENR_ON_UNCLEANED_CONTACT: "medium",
  ENR_SITE_MISMATCH_CONTACT: "medium",
  JOB_ABBREVIATION: "low",
  JOB_DEPARTMENT_ONLY: "medium",
  JOB_DUPLICATED_WORDS: "medium",
  JOB_EMBEDS_COMPANY: "medium",
  JOB_HAS_NOISE: "medium",
  JOB_HAS_QUALIFICATION: "high",
  JOB_IN_PARENTHESES: "low",
  JOB_LOWERCASE: "low",
  JOB_MISSING: "info",
  JOB_NOT_A_TITLE: "high",
  JOB_TOO_LONG: "medium",
  JOB_TRAILING_PUNCT: "low",
  LINKEDIN_BAD_FORMAT: "medium",
  LOCATION_DELIMITER_JUNK: "high",
  LOCATION_IS_ADDRESS_FRAGMENT: "medium",
  LOCATION_MISSING_ADDRESS_AVAILABLE: "medium",
  LOCATION_SEPARATOR_ONLY: "high",
  LOCATION_TRUNCATED: "high",
  MOBILE_INVALID_LENGTH_OR_PREFIX: "high",
  MOBILE_NOT_E164: "low",
  NAME_ALLCAPS: "info",
  NAME_CONTAINS_COMPANY_WORDS: "medium",
  NAME_DASH_COMPOSITE: "high",
  NAME_DOUBLE_SPACE: "low",
  NAME_HAS_DIGITS: "medium",
  NAME_HAS_URL_EMAIL: "high",
  NAME_HONORIFIC: "low",
  NAME_MOJIBAKE: "high",
  NAME_PLACEHOLDER: "high",
  NAME_SINGLE_TOKEN: "info",
  NAME_SOURCE_TAG: "high",
  NO_CONTACT_METHOD: "medium",
  TEL_BAD_LENGTH: "high",
  TEL_CONTAINS_MOBILE: "high",
  TEL_DUPLICATES_MOBILE: "medium",
  TEL_HAS_TEXT: "medium",
  TEL_PLUS91_WITH_ZERO: "medium",
  WEBSITE_EMAIL_DOMAIN_MISMATCH: "medium",
  WEBSITE_INVALID: "high",
  WEBSITE_UPPERCASE: "low",
} as const satisfies Record<string, Severity>;

export type RuleId = keyof typeof RULE_SEVERITY;

export interface Flag {
  rule: RuleId;
  severity: Severity;
  column: string;
  detail?: string;
}

export interface ContactLike {
  id?: string;
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
  mobileNumbers: string[];
  telephoneNumbers: string[];
  emails: string[];
  website: string | null;
  address: string | null;
  companyLocation: string | null;
  linkedin: string | null;
}

export interface EnrichmentLike {
  status: string;
  linkedin_url: string | null;
  official_site: string | null;
  location: string | null;
  company_details: string | null;
  career_background: string | null;
  summary: string | null;
  attempts: number;
  completed: number;
  failed: number;
  expected: number;
  enriched_at: Date | null;
}

export interface FlagsContext {
  /** Domain -> email count across the whole table. */
  domainFrequency?: Map<string, number>;
  /** Contact ids that share a phone with another contact. */
  sharedPhoneIds?: Set<string>;
  /** Contact ids that share an alnum name with another contact. */
  duplicateNameIds?: Set<string>;
  /** Contact ids whose name/company the cleanup scripts rewrote. */
  uncleanedIds?: Set<string>;
}

const E164 = /^\+\d{7,15}$/;
const BUSINESS_WORDS =
  /\b(pvt|private|ltd|limited|llp|enterprises?|engineers?|engineering|traders?|trading|electricals?|constructions?|infra\w*|industries|associates|contractors?|services|solutions|works|corporation|corp|company|printers?|transformers?|erection|commissioning|agency|agencies)\b/i;
const ADDRESS_WORDS =
  /\b(road|street|st\.?|floor|sector|block|nagar|colony|marg|lane|industrial|estate|plot|building|bhavan|complex|chowk|cross)\b/i;
const DEPARTMENTS = new Set(["purchase", "procurement", "scm", "stores", "finance", "hr", "accounts", "logistics"]);

function hostOf(value: string | null): string | null {
  if (!value) return null;
  const stripped = value.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0];
  return stripped ? stripped.toLowerCase().replace(/^www\./, "") : null;
}

function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

export function detectFlags(
  contact: ContactLike,
  enrichment?: EnrichmentLike | null,
  ctx: FlagsContext = {},
): Flag[] {
  const flags: Flag[] = [];
  const add = (rule: RuleId, column: string, detail?: string) =>
    flags.push({ rule, severity: RULE_SEVERITY[rule], column, ...(detail ? { detail } : {}) });

  const name = norm(contact.fullName);
  const company = norm(contact.company);
  const job = norm(contact.jobTitle);
  const location = norm(contact.companyLocation);
  const website = norm(contact.website);
  const address = norm(contact.address);

  // ----- fullName -----
  if (contact.fullName !== null) {
    if (stripSourceTag(name).tag) add("NAME_SOURCE_TAG", "fullName");
    if (/-/.test(name) && (parseComposite(name)?.segments.length ?? 0) >= 2) {
      add("NAME_DASH_COMPOSITE", "fullName");
    }
    if (/\s{2,}/.test(contact.fullName)) add("NAME_DOUBLE_SPACE", "fullName");
    if (stripHonorifics(name) !== name) add("NAME_HONORIFIC", "fullName");
    if (repairMojibake(contact.fullName).repaired) add("NAME_MOJIBAKE", "fullName");
    if (/https?:\/\/|@/.test(name)) add("NAME_HAS_URL_EMAIL", "fullName");
    if (name && /^[-\s]+$/.test(name)) add("NAME_PLACEHOLDER", "fullName");
    const tokens = name.split(/\s+/).filter(Boolean);
    if (tokens.length === 1 && name) add("NAME_SINGLE_TOKEN", "fullName");
    if (tokens.length >= 2 && tokens.every((t) => /^[A-Z0-9.&'-]+$/.test(t))) {
      add("NAME_ALLCAPS", "fullName");
    }
    if (/\d/.test(name)) add("NAME_HAS_DIGITS", "fullName");
    if (BUSINESS_WORDS.test(name)) add("NAME_CONTAINS_COMPANY_WORDS", "fullName");
  }

  // ----- company -----
  if (contact.company !== null) {
    if (/-{2,}|^-+|-+$/.test(company)) add("COMPANY_DASH_JUNK", "company");
    if (/\s{2,}/.test(contact.company)) add("COMPANY_DOUBLE_SPACE", "company");
    if (ADDRESS_WORDS.test(company) || /\b\d{6}\b/.test(company)) add("COMPANY_HAS_ADDRESS", "company");
    if (/https?:\/\/|www\.|\+?\d[\d\s-]{7,}/.test(company)) add("COMPANY_HAS_URL_PHONE", "company");
    if (company && isBareCity(company)) add("COMPANY_IS_CITY", "company");
    if (isNotARole(company)) add("COMPANY_IS_JOB_TITLE", "company");
    if (contact.fullName && companyIsPersonName(contact.fullName, company)) {
      add("COMPANY_IS_PERSON_NAME", "company");
    }
    if (company.includes(";")) add("COMPANY_MULTI_CANDIDATE", "company");
    if (/[\uFFFD]|^\S+$/.test(company) && !/[aeiouAEIOU]/.test(company) && company.length > 4) {
      add("COMPANY_OCR_GARBAGE", "company");
    }
    if (/^[-\s]+$/.test(company) || company === "") add("COMPANY_PLACEHOLDER", "company");
    if (/^[A-Z]{3}$/.test(company)) add("COMPANY_SHORT_CODE", "company");
    if (stripSourceTag(company).tag) add("COMPANY_SOURCE_TAG", "company");
  }

  // ----- jobTitle -----
  if (!job) {
    add("JOB_MISSING", "jobTitle");
  } else {
    if (/\b(Sr|Asst|Asstt|Dy|Mgr)\.?(?=\s|$)/i.test(job)) add("JOB_ABBREVIATION", "jobTitle");
    if (DEPARTMENTS.has(job.toLowerCase())) add("JOB_DEPARTMENT_ONLY", "jobTitle");
    if (/\b(\w+)\s+\1\b/i.test(job)) add("JOB_DUPLICATED_WORDS", "jobTitle");
    if (company && new RegExp(`\\b${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(job)) {
      add("JOB_EMBEDS_COMPANY", "jobTitle");
    }
    if (/[^\w\s\-&.,()/@+]/.test(job)) add("JOB_HAS_NOISE", "jobTitle");
    if (extractQualifications(job).quals.length > 0) add("JOB_HAS_QUALIFICATION", "jobTitle");
    if (/^\(.*\)$/.test(job.trim())) add("JOB_IN_PARENTHESES", "jobTitle");
    if (/^[a-z]/.test(job)) add("JOB_LOWERCASE", "jobTitle");
    if (isNotARole(job)) add("JOB_NOT_A_TITLE", "jobTitle");
    if (job.length > 80) add("JOB_TOO_LONG", "jobTitle");
    if (/[,;.\-]$/.test(job)) add("JOB_TRAILING_PUNCT", "jobTitle");
  }

  // ----- phones -----
  const mobileE164 = new Set(
    contact.mobileNumbers.map((m) => parsePhone(m).e164).filter((v): v is string => !!v),
  );
  if (contact.telephoneNumbers.some((t) => parsePhone(t).kind === "MOBILE")) {
    add("TEL_CONTAINS_MOBILE", "telephoneNumbers");
  }
  if (contact.mobileNumbers.some((m) => !E164.test(m))) add("MOBILE_NOT_E164", "mobileNumbers");
  if (contact.mobileNumbers.some((m) => parsePhone(m).kind === "INVALID")) {
    add("MOBILE_INVALID_LENGTH_OR_PREFIX", "mobileNumbers");
  }
  if (
    contact.telephoneNumbers.some((t) => {
      const digits = t.replace(/\D/g, "");
      return digits.length > 15 && splitConcatenated(t) === null;
    })
  ) {
    add("TEL_BAD_LENGTH", "telephoneNumbers");
  }
  if (
    contact.telephoneNumbers.some((t) => {
      const withoutExt = t
        .replace(/\s*(ext|extn|extension)\.?\s*:?\s*\d+\s*$/i, "")
        .replace(/\s+x\.?\s*\d+\s*$/i, "")
        .replace(/\(D\)/i, "");
      return /[A-Za-z]/.test(withoutExt);
    })
  ) {
    add("TEL_HAS_TEXT", "telephoneNumbers");
  }
  if (contact.telephoneNumbers.some((t) => /^\+91[\s-]*0/.test(t))) {
    add("TEL_PLUS91_WITH_ZERO", "telephoneNumbers");
  }
  if (
    contact.telephoneNumbers.some((t) => {
      const e164 = parsePhone(t).e164;
      return e164 !== null && mobileE164.has(e164);
    })
  ) {
    add("TEL_DUPLICATES_MOBILE", "telephoneNumbers");
  }
  if (contact.mobileNumbers.length + contact.telephoneNumbers.length + contact.emails.length === 0) {
    add("NO_CONTACT_METHOD", "contact");
  }

  // ----- emails / website / linkedin -----
  if (contact.emails.some((e) => !validateEmail(e))) add("EMAIL_INVALID", "emails");
  if (ctx.domainFrequency && contact.emails.length > 1) {
    const variant = resolveOcrVariants(contact.emails, ctx.domainFrequency);
    if (variant.dropped.length > 0 || variant.review) add("EMAIL_OCR_VARIANT_PAIR", "emails");
  }
  if (website && !normalizeWebsite(contact.website!).valid) add("WEBSITE_INVALID", "website");
  if (website && /[A-Z]/.test(website.replace(/^[a-z]+:\/\//i, "").split("/")[0])) {
    add("WEBSITE_UPPERCASE", "website");
  }
  const siteHost = hostOf(contact.website);
  const mailDomain = contact.emails.map(emailDomain).find((d): d is string => !!d) ?? null;
  if (siteHost && mailDomain && siteHost !== mailDomain) {
    add("WEBSITE_EMAIL_DOMAIN_MISMATCH", "website");
  }
  if (contact.linkedin && !normalizeLinkedin(contact.linkedin).value) {
    add("LINKEDIN_BAD_FORMAT", "linkedin");
  }

  // ----- companyLocation / address -----
  if (location.includes(":::")) add("LOCATION_DELIMITER_JUNK", "companyLocation");
  if (location && /^[:\s;]+$/.test(location)) add("LOCATION_SEPARATOR_ONLY", "companyLocation");
  if (
    location &&
    !canonicalState(location) &&
    location.length >= 5 &&
    INDIAN_STATES.some((s) => s.toLowerCase().startsWith(location.toLowerCase()))
  ) {
    add("LOCATION_TRUNCATED", "companyLocation");
  }
  if (location && (/\d{3,}/.test(location) || /[,]/.test(location) || ADDRESS_WORDS.test(location))) {
    add("LOCATION_IS_ADDRESS_FRAGMENT", "companyLocation");
  }
  if (!location && address) add("LOCATION_MISSING_ADDRESS_AVAILABLE", "companyLocation");
  if (address && !/\b\d{6}\b/.test(address)) add("ADDRESS_NO_PINCODE", "address");
  if (address && /\b\d{5}\b/.test(address) && !/\b\d{6}\b/.test(address)) {
    add("ADDRESS_NOT_INDIAN_FORMAT", "address");
  }

  // ----- cross-row -----
  if (contact.id && ctx.sharedPhoneIds?.has(contact.id)) add("DUP_SHARED_PHONE", "(row)");
  if (contact.id && ctx.duplicateNameIds?.has(contact.id)) add("DUP_SAME_NAME", "(row)");
  if (contact.id && ctx.uncleanedIds?.has(contact.id)) add("ENR_ON_UNCLEANED_CONTACT", "enrichment");

  // ----- enrichment -----
  if (enrichment) {
    const text = `${enrichment.summary ?? ""} ${enrichment.career_background ?? ""}`.toLowerCase();
    if (
      enrichment.status === "DONE" &&
      /did not clearly|does not clearly|do not clearly|could not be confirmed|no reliable|not clearly identify|unable to (?:verify|find)|no verified|not publicly/.test(
        text,
      )
    ) {
      add("ENR_DONE_BUT_UNVERIFIED", "enrichment.status");
    }
    if (
      (enrichment.status === "DONE" || enrichment.status === "PARTIAL") &&
      !enrichment.enriched_at
    ) {
      add("ENR_ENRICHED_AT_NULL", "enrichment.enriched_at");
    }
    if (
      enrichment.attempts + enrichment.completed + enrichment.failed + enrichment.expected === 0
    ) {
      add("ENR_COUNTERS_UNSET", "enrichment.counters");
    }
    if (!enrichment.linkedin_url) add("ENR_NO_LINKEDIN", "enrichment.linkedin_url");
    const officialHost = hostOf(enrichment.official_site);
    if (officialHost && siteHost && officialHost !== siteHost) {
      add("ENR_SITE_MISMATCH_CONTACT", "enrichment.official_site");
    }
  }

  return flags;
}
