// scripts/clean-name-job-company.ts
//
// Cleans fullName, jobTitle and company on Contact.
//
// Order of operations per row:
//   1. Free deterministic rules (every row): honorific + source-tag strip,
//      company-candidate cleanup, job-title normalisation.
//   2. Deterministic composite parse (Company-Division-Industry-Title-Dept) for
//      dash-joined values. A high-confidence parse is applied directly; a
//      low-confidence parse is passed to the LLM as a hint.
//   3. Any still-flagged row goes to ONE LLM prompt. Guards decide whether the
//      result is applied or sent to review.
//
// `china ...` sourcing-lead rows are never sent to the person-name prompt: they
// are recorded in the review file with reason `sourcing_lead` (decision D6).
//
// Department / industry / division text is NOT split into separate fields
// (decision D1): department stays in the job title, division stays with the
// company.
//
// Flags: --dry-run | --no-llm | --limit=N
//
// Run: npx tsx scripts/clean-name-job-company.ts [--dry-run] [--no-llm] [--limit=25]

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ScriptAudit, isDryRun } from "./scriptAudit";
import { writeSnapshot } from "./scriptSnapshot";
import { chatRows } from "./llm";
import {
  alnum,
  norm,
  stripHonorifics,
  stripSourceTag,
} from "./cleaning/text";
import {
  extractQualifications,
  isNotARole,
  normalizeTitle,
  stripCompanyFromJob,
} from "./cleaning/job";
import {
  canonicalCompanyKey,
  cleanCompany,
  companyIsPersonName,
  looksLikePersonName,
} from "./cleaning/company";
import { parseComposite } from "./cleaning/composite";

const DRY_RUN = isDryRun();
const NO_LLM = process.argv.includes("--no-llm");
const LIMIT =
  Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity;
const BATCH = 20;
const MIN_CONFIDENCE = 0.6;
const audit = new ScriptAudit("clean-name-job-company", DRY_RUN);

type Fields = { fullName: string | null; jobTitle: string | null; company: string | null };

interface RawRow extends Fields {
  id: string;
  flags: string[];
  hint?: string;
}

interface ParsedRow {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyConflict?: boolean;
  reason?: string;
  confidence: number;
}

const BUSINESS_WORDS =
  /\b(pvt|private|ltd|limited|llp|enterprises?|engineers?|engineering|traders?|trading|electricals?|constructions?|infra\w*|industries|associates|contractors?|services|solutions|works|corporation|corp|company|printers?|transformers?|erection|commissioning|agency|agencies)\b/i;

const isPlaceholder = (value: string | null): boolean => {
  const n = norm(value);
  return n === "" || /^[-\s]+$/.test(n);
};

const isChinaRow = (value: string | null): boolean => /^\s*china\b/i.test(value ?? "");

/** Free-pass person name: strip a striptag-able tag, then honorifics. */
function cleanPersonName(value: string | null): string | null {
  const n = norm(value);
  if (!n) return null;
  const tagStripped = stripSourceTag(n);
  return norm(stripHonorifics(tagStripped.value)) || null;
}

/** Free-pass job title. Returns the original value plus a review reason when rejected. */
function cleanJobFree(
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

/** Deterministic composite pass (step 2). Returns the (possibly updated) fields. */
function compositePass(fields: Fields): {
  fields: Fields;
  hint?: string;
  review?: string;
  applied: boolean;
} {
  const companyHasDash = /-/.test(fields.company ?? "");
  const nameHasDash = /-/.test(fields.fullName ?? "");
  const input = companyHasDash ? fields.company! : nameHasDash ? fields.fullName! : null;
  if (!input) return { fields, applied: false };

  const parsed = parseComposite(input);
  if (!parsed || parsed.segments.length < 2) return { fields, applied: false };

  if (parsed.confidence === "low") {
    return { fields, hint: JSON.stringify(parsed), applied: false };
  }

  const next: Fields = { ...fields };
  if (parsed.company) next.company = parsed.company;
  if (parsed.jobTitle) next.jobTitle = parsed.jobTitle;
  if (!companyHasDash && nameHasDash) next.fullName = null;

  return { fields: next, applied: true };
}

function suspicionFlags(original: Fields): string[] {
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

  const host = row.website
    ? row.website.replace(/^https?:\/\//i, "").split("/")[0]
    : row.emails[0]?.split("@")[1];
  if (host && host.includes(".")) {
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

// ---------- LLM ----------

const SYSTEM_PROMPT = `You clean messy CRM contact records (Indian B2B business cards). Each input row has
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

// ---------- guards ----------

function guard(raw: RawRow, result: ParsedRow): string | null {
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

const chunk = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

// ---------- main ----------

async function main() {
  const contacts = await prisma.contact.findMany({
    select: {
      id: true,
      fullName: true,
      jobTitle: true,
      company: true,
      website: true,
      emails: true,
      enrichment: { select: { company_details: true } },
    },
  });
  console.log(
    `Loaded ${contacts.length} rows.${DRY_RUN ? " (dry run)" : ""}${NO_LLM ? " (no LLM)" : ""}`,
  );

  const original = new Map<string, Fields>();
  const current = new Map<string, Fields>();
  const queue: RawRow[] = [];
  const deterministic = new Set<string>();
  const reasons = new Map<string, number>();

  const noteReview = (id: string, field: string, reason: string, proposed?: unknown) => {
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    audit.review(id, field, { reason, proposed, source: "clean-name-job-company" });
  };

  for (const contact of contacts) {
    const before: Fields = {
      fullName: contact.fullName,
      jobTitle: contact.jobTitle,
      company: contact.company,
    };
    original.set(contact.id, before);

    let fields: Fields = {
      fullName: cleanPersonName(contact.fullName),
      jobTitle: cleanJobFree(contact.jobTitle, cleanCompany(contact.company)).value,
      company: cleanCompany(contact.company),
    };

    if (contact.jobTitle) {
      const rejected = cleanJobFree(contact.jobTitle, fields.company).rejected;
      if (rejected) noteReview(contact.id, "jobTitle", rejected, contact.jobTitle);
    }

    const composite = compositePass(fields);
    if (composite.applied) {
      fields = composite.fields;
      deterministic.add(contact.id);
    }

    current.set(contact.id, fields);

    if (isChinaRow(contact.fullName) || isChinaRow(contact.company)) {
      noteReview(contact.id, "fullName", "sourcing_lead", contact.fullName);
      continue;
    }

    if (fields.company && contact.fullName && companyIsPersonName(contact.fullName, fields.company)) {
      for (const suggestion of companySuggestions(fields.company, contact.fullName, contact)) {
        noteReview(contact.id, "company", `company_is_person_name (${suggestion.source})`, suggestion.value);
      }
    }

    const flags = suspicionFlags(before);
    if (flags.length && !deterministic.has(contact.id)) {
      queue.push({ id: contact.id, ...before, flags, hint: composite.hint });
    }
  }

  console.log(`Rows queued for LLM: ${queue.length}`);

  let applied = 0;
  let rejected = 0;

  if (!NO_LLM && queue.length) {
    const batches = chunk(queue.slice(0, LIMIT), BATCH);
    const rawById = new Map(queue.map((row) => [row.id, row]));

    for (let i = 0; i < batches.length; i++) {
      console.log(`LLM batch ${i + 1}/${batches.length}...`);
      const results = await chatRows<ParsedRow>({
        system: SYSTEM_PROMPT,
        user: batches[i],
      });

      for (const result of results) {
        const raw = rawById.get(result.id);
        if (!raw) continue;
        const currentFields = current.get(result.id)!;
        const why = guard(raw, result);
        if (why) {
          rejected++;
          noteReview(result.id, "fullName", why, JSON.stringify(result));
          continue;
        }
        current.set(result.id, {
          fullName: cleanPersonName(result.fullName),
          jobTitle: result.jobTitle
            ? normalizeTitle(result.jobTitle) ?? currentFields.jobTitle
            : currentFields.jobTitle,
          company: cleanCompany(result.company) ?? currentFields.company,
        });
        applied++;
      }
    }
  }

  // Diff against the ORIGINAL DB values and persist.
  let changedRows = 0;
  const counts = { fullName: 0, jobTitle: 0, company: 0 };
  const planned: { id: string; data: Partial<Fields> }[] = [];
  const snapshotRows: Record<string, unknown>[] = [];

  for (const [id, before] of original) {
    const after = current.get(id)!;
    const data: Partial<Fields> = {};
    for (const field of ["fullName", "jobTitle", "company"] as const) {
      if ((before[field] ?? null) !== (after[field] ?? null)) {
        data[field] = after[field];
        counts[field]++;
        audit.record(id, field, before[field], after[field]);
      }
    }
    if (Object.keys(data).length) {
      changedRows++;
      planned.push({ id, data });
      const originalRow = contacts.find((c) => c.id === id);
      if (originalRow) {
        snapshotRows.push({
          id: originalRow.id,
          fullName: originalRow.fullName,
          jobTitle: originalRow.jobTitle,
          company: originalRow.company,
        });
      }
    }
  }

  if (!DRY_RUN && planned.length > 0) {
    const file = writeSnapshot("clean-name-job-company", snapshotRows);
    console.log(`Snapshot written to ${file} (${snapshotRows.length} rows)`);
  }

  let written = 0;
  for (let i = 0; i < planned.length && !DRY_RUN; i += 100) {
    const batch = planned.slice(i, i + 100);
    await prisma.$transaction(
      batch.map((change) =>
        prisma.contact.update({ where: { id: change.id }, data: change.data }),
      ),
    );
    written += batch.length;
    console.log(`Applied ${written}/${planned.length}`);
  }

  const histogram = [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ");

  const summary =
    `Rows changed: ${changedRows} (fullName ${counts.fullName}, jobTitle ${counts.jobTitle}, ` +
    `company ${counts.company}). Queued ${queue.length}, LLM applied ${applied}, ` +
    `sent to review ${rejected}. Review reasons: ${histogram || "none"}.`;
  console.log(summary);
  if (DRY_RUN) console.log("Dry run - no database writes were made.");
  audit.logRun(summary);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    audit.write();
    prisma.$disconnect();
  });
