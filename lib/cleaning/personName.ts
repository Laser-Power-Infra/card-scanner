/**
 * Per-contact name / job-title / company cleaning.
 *
 * Deterministic rules first. Rows that still look suspicious produce one LLM
 * row payload; the caller decides whether to send it. Extracted from
 * scripts/clean-name-job-company.ts so a single contact can be processed from
 * the CLI or the new-entry pipeline.
 *
 * No Prisma, no filesystem. The LLM transport lives in ../llm.
 */

import {
  alnum,
  norm,
  SOURCE_TAGS,
  stripHonorifics,
  stripSourceTag,
} from "./text";
import {
  extractQualifications,
  isNotARole,
  normalizeTitle,
  stripCompanyFromJob,
} from "./job";
import {
  canonicalCompanyKey,
  cleanCompany,
  companyIsPersonName,
  looksLikePersonName,
} from "./company";
import { parseComposite } from "./composite";

export type PersonFields = {
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
};

export interface PersonSource extends PersonFields {
  id: string;
  website: string | null;
  emails: string[];
  enrichment: { company_details: string | null } | null;
}

export interface PersonReview {
  field: string;
  reason: string;
  proposed?: unknown;
}

export interface PersonLlmRow extends PersonFields {
  id: string;
  flags: string[];
  hint?: string;
}

export interface PersonLlmResult {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyConflict?: boolean;
  reason?: string;
  confidence: number;
}

export interface PersonPlan {
  fields: PersonFields;
  reviews: PersonReview[];
  llmRow: PersonLlmRow | null;
}

const MIN_CONFIDENCE = 0.6;

const BUSINESS_WORDS =
  /\b(pvt|private|ltd|limited|llp|enterprises?|engineers?|engineering|traders?|trading|electricals?|constructions?|infra\w*|industries|associates|contractors?|services|solutions|works|corporation|corp|company|printers?|transformers?|erection|commissioning|agency|agencies)\b/i;

const isPlaceholder = (value: string | null): boolean => {
  const n = norm(value);
  return n === "" || /^[-\s]+$/.test(n);
};

const isChinaRow = (value: string | null): boolean => /^\s*china\b/i.test(value ?? "");

/** Free-pass person name: strip a striptag-able tag, then honorifics. */
export function cleanPersonName(value: string | null): string | null {
  const n = norm(value);
  if (!n) return null;
  const tagStripped = stripSourceTag(n);
  return norm(stripHonorifics(tagStripped.value)) || null;
}

/** Free-pass job title. Returns the original value plus a review reason when rejected. */
export function cleanJobFree(
  job: string | null,
  company: string | null,
): { value: string | null; rejected: string | null } {
  if (!job) return { value: job, rejected: null };
  const normalized = normalizeTitle(stripCompanyFromJob(job, company));
  if (!normalized) return { value: null, rejected: null };
  if (isNotARole(normalized)) return { value: job, rejected: `not_a_role: ${normalized}` };
  const { title } = extractQualifications(normalized);
  if (!title) return { value: job, rejected: `qualification_only: ${job}` };
  return { value: title, rejected: null };
}

/** Deterministic composite apply from the `company` column. */
function applyCompanyComposite(fields: PersonFields): { fields: PersonFields } | null {
  const parsed = parseComposite(fields.company ?? "");
  if (!parsed || parsed.segments.length < 2 || parsed.confidence === "low") return null;

  const company = parsed.company ? norm(parsed.company.replace(SOURCE_TAGS, "")) : null;
  const jobTitle = parsed.jobTitle ? normalizeTitle(parsed.jobTitle) : null;

  return {
    fields: {
      ...fields,
      ...(company ? { company } : {}),
      ...(jobTitle ? { jobTitle } : {}),
    },
  };
}

function compositePass(fields: PersonFields): {
  fields: PersonFields;
  hint?: string;
  applied: boolean;
} {
  let next = fields;
  let changed = false;
  let nameHint: string | undefined;

  if (/-/.test(next.company ?? "")) {
    const applied = applyCompanyComposite(next);
    if (applied) {
      next = applied.fields;
      changed = true;
    }
  }

  if (/-/.test(next.fullName ?? "")) {
    const parsed = parseComposite(next.fullName!);
    if (parsed && parsed.segments.length >= 2) {
      const first = parsed.segments[0];
      const companyLike =
        BUSINESS_WORDS.test(first) || (/[A-Z]{3}/.test(first) && first === first.toUpperCase());
      const existingKey = canonicalCompanyKey(next.company);
      const parsedKey = canonicalCompanyKey(parsed.company);
      const companyCompatible =
        !next.company ||
        (parsedKey.length > 0 &&
          (existingKey === parsedKey ||
            existingKey.includes(parsedKey) ||
            parsedKey.includes(existingKey)));

      if (parsed.confidence === "high" && companyLike && parsed.jobTitle && companyCompatible) {
        return {
          fields: {
            fullName: null,
            jobTitle: next.jobTitle ?? parsed.jobTitle,
            company: next.company ?? norm(parsed.company!.replace(SOURCE_TAGS, "")),
          },
          applied: true,
        };
      }
      nameHint = JSON.stringify(parsed);
    }
  }

  if (changed) return { fields: next, ...(nameHint ? { hint: nameHint } : {}), applied: true };
  return nameHint ? { fields, hint: nameHint, applied: false } : { fields, applied: false };
}

function suspicionFlags(original: PersonFields): string[] {
  const flags: string[] = [];
  const name = original.fullName ?? "";
  const company = original.company ?? "";
  const { tag } = stripSourceTag(name);
  if (tag && tag !== "T") flags.push("source_tag");
  if (tag === "T") flags.push("source_tag_t");
  if (isPlaceholder(name) && norm(original.company) === "") flags.push("placeholder");
  if (/\s{2,}/.test(name)) flags.push("double_space");
  if (/[/|,]|\d{3,}|-{2,}|\(|\)/.test(name)) flags.push("name_separator");
  if (BUSINESS_WORDS.test(name)) flags.push("business_words_in_name");
  if (norm(name).split(/\s+/).filter(Boolean).length >= 5) flags.push("long_name");
  if (/-{2,}|;/.test(company)) flags.push("company_junk");
  if (looksLikePersonName(company)) flags.push("company_looks_like_person");
  if (/-{2,}|\|/.test(original.jobTitle ?? "")) flags.push("job_junk");
  if (original.jobTitle && isNotARole(original.jobTitle)) flags.push("job_not_a_role");
  return flags;
}

/** Non-applied company suggestions for a `COMPANY_IS_PERSON_NAME` row. */
function companySuggestions(
  company: string,
  fullName: string,
  row: { website: string | null; emails: string[]; enrichment: { company_details: string | null } | null },
): { value: string; source: string }[] {
  const suggestions: { value: string; source: string }[] = [];

  for (const candidate of company.split(";").map((c) => norm(c))) {
    if (candidate && candidate !== company && !companyIsPersonName(fullName, candidate)) {
      suggestions.push({ value: candidate, source: "semicolon_candidate" });
    }
  }

  const host = (
    row.website ? row.website.replace(/^https?:\/\//i, "").split("/")[0] : row.emails[0]?.split("@")[1]
  )?.toLowerCase();
  const freeMail = new Set([
    "gmail.com",
    "yahoo.com",
    "yahoo.co.in",
    "outlook.com",
    "hotmail.com",
    "rediffmail.com",
    "live.com",
    "icloud.com",
    "protonmail.com",
    "aol.com",
  ]);
  if (host && host.includes(".") && !freeMail.has(host)) {
    const label = host.split(".")[0].replace(/[^a-z0-9]/gi, " ");
    if (label) suggestions.push({ value: norm(label), source: "domain" });
  }

  const details = row.enrichment?.company_details;
  if (details) {
    const firstSentence = norm(details.split(/[.\n]/)[0]);
    if (firstSentence) suggestions.push({ value: firstSentence, source: "enrichment.company_details" });
  }

  return suggestions;
}

export const PERSON_SYSTEM_PROMPT = `You clean messy CRM contact records (Indian B2B business cards). Each input row has
fullName, jobTitle, company, "flags" describing what looked wrong, and optionally a
"hint" (a deterministic parse of a composite string). Return cleaned values.

Rules:
- fullName must be a HUMAN name or null. Every word of it must appear in the input row
  (fullName, jobTitle or company). Never invent, expand, reorder or "repair" a name.
  If no human name is identifiable, return null.
- Import tags are never part of a name: DOM, EXP, CHINA, DEPTT, LASER, GMD, T, SOM, NEW,
  Er., Mr., Ms., Sir, Ji. Strip them. If the tag text is a company (e.g. LASER), it may
  be the company.
- "Sri/Shri" is an honorific only before a personal name. "Sri Ram Drum" is a company.
- A fullName that is really a company or a service description -> fullName null.
- Composite strings look like Company-Division-Industry-JobTitle-Department. Put the
  company in "company" (keeping division/industry with it as "Company - Division"). Put
  the job title in "jobTitle" and KEEP its department inside it, formatted
  "Title - Department" (e.g. "Manager - Procurement"). Never create separate department
  or industry fields.
- jobTitle format: Senior, Assistant, Deputy, Manager (not Sr./Asstt./Dy./Mgr.).
- company: several candidates separated by ";" -> choose the most complete, formal one.
  If the existing company is already clean and the name string mentions a DIFFERENT
  company, keep the existing company and set companyConflict=true.

Return ONLY JSON: {"rows":[{"id":"...","fullName":string|null,"jobTitle":string|null,
"company":string|null,"companyConflict":boolean,"reason":"short","confidence":0..1}]}`;

/** Guard an LLM result before applying it. Returns a review reason or null. */
export function guardPersonResult(raw: PersonLlmRow, result: PersonLlmResult): string | null {
  if ((result.confidence ?? 0) < MIN_CONFIDENCE) return `low_confidence(${result.confidence})`;

  if (result.fullName) {
    const hay = alnum(`${raw.fullName} ${raw.company} ${raw.jobTitle}`);
    const invented = result.fullName
      .split(/\s+/)
      .filter((word) => alnum(word).length > 1 && !hay.includes(alnum(word)));
    if (invented.length) return `invented_name(${invented.join(",")})`;
  }

  const currentClean =
    raw.company && !raw.flags.some((f) => f.startsWith("company") || f === "source_tag_company");
  const changed =
    result.company && canonicalCompanyKey(result.company) !== canonicalCompanyKey(raw.company);
  if (currentClean && changed) return "company_conflict";

  return null;
}

/** Build the deterministic plan for one contact. */
export function planPersonName(source: PersonSource): PersonPlan {
  const before: PersonFields = {
    fullName: source.fullName,
    jobTitle: source.jobTitle,
    company: source.company,
  };
  const reviews: PersonReview[] = [];

  const company = cleanCompany(source.company);
  const job = cleanJobFree(source.jobTitle, company);
  if (job.rejected) {
    reviews.push({ field: "jobTitle", reason: job.rejected, proposed: source.jobTitle });
  }

  let fields: PersonFields = {
    fullName: cleanPersonName(source.fullName),
    jobTitle: job.value,
    company,
  };

  const composite = compositePass(fields);
  const deterministic = composite.applied;
  if (composite.applied) {
    fields = composite.fields;
  }

  if (isChinaRow(source.fullName) || isChinaRow(source.company)) {
    reviews.push({ field: "fullName", reason: "sourcing_lead", proposed: source.fullName });
    return { fields, reviews, llmRow: null };
  }

  if (fields.company && source.fullName && companyIsPersonName(source.fullName, fields.company)) {
    for (const suggestion of companySuggestions(fields.company, source.fullName, source)) {
      reviews.push({
        field: "company",
        reason: `company_is_person_name (${suggestion.source})`,
        proposed: suggestion.value,
      });
    }
  }

  const flags = suspicionFlags(before);
  const llmRow =
    flags.length && !deterministic
      ? { id: source.id, ...before, flags, ...(composite.hint ? { hint: composite.hint } : {}) }
      : null;

  return { fields, reviews, llmRow };
}

/** Apply one LLM row result, guarded. */
export function applyPersonLlmResult(
  raw: PersonLlmRow,
  current: PersonFields,
  result: PersonLlmResult,
): { fields: PersonFields; review: PersonReview | null } {
  const why = guardPersonResult(raw, result);
  if (why) {
    return {
      fields: current,
      review: { field: "fullName", reason: why, proposed: result },
    };
  }

  return {
    fields: {
      fullName: cleanPersonName(result.fullName),
      jobTitle: result.jobTitle
        ? normalizeTitle(result.jobTitle) ?? current.jobTitle
        : current.jobTitle,
      company: cleanCompany(result.company) ?? current.company,
    },
    review: null,
  };
}
