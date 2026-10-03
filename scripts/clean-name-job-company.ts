// scripts/clean-name-job-company.ts
//
// Cleans fullName, jobTitle and company on Contact.
// Department / industry / division text is NOT split into separate fields: it stays
// in the field it was extracted from (department stays in jobTitle, e.g. "Manager - Procurement").
//
//  1. Free rules (every row, persisted): honorific cleanup, jobTitle cleanup + normalisation,
//     company candidate cleanup.
//  2. Any row with a suspicion flag goes to ONE LLM prompt (flags are sent with the row).
//  3. Guards decide whether an LLM result is applied or sent to review (__review__ in the log).
//
// Flags: --dry-run (no DB writes, LLM still runs) | --no-llm | --limit=N (rows sent to LLM)

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ScriptAudit } from "../lib/scriptAudit";

const DRY_RUN = process.argv.includes("--dry-run");
const NO_LLM = process.argv.includes("--no-llm");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity;
const MIN_CONFIDENCE = 0.6;
const BATCH = 20;
const audit = new ScriptAudit("clean-name-job-company", DRY_RUN);

type Fields = { fullName: string | null; jobTitle: string | null; company: string | null };

// ---------- helpers ----------

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const orNull = (s: string) => (s ? s : null);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alnum = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const wordCount = (s: string | null) => norm(s).split(" ").filter(Boolean).length;

// "Sri/Shri" is deliberately NOT here: "Sri Ram Drum" is a company. The LLM decides.
const HONORIFIC_SUFFIX = /\s+(sir|ji|saab|sahab|saheb|madam|maam|mam)\.?\s*$/i;
const HONORIFIC_PREFIX = /^\s*(mr|mrs|ms|er)\.?\s+/i;
const SOURCE_TAGS = /^\s*(DOMs?|EXP|LASER|GMD|T|SOM|NEW)\b[\s.\-\/]/i;
const BUSINESS_WORDS =
  /\b(pvt|private|ltd|limited|llp|enterprises?|engineers?|engineering|traders?|trading|electricals?|constructions?|infra\w*|industries|associates|contractors?|services|solutions|works|corporation|corp|company|printers?|transformers?|erection|commissioning|agency|agencies)\b/i;

function cleanPersonName(name: string | null): string | null {
  if (!name) return null;
  const n = norm(name);
  const stripped = norm(n.replace(HONORIFIC_SUFFIX, "").replace(HONORIFIC_PREFIX, ""));
  return orNull(stripped || n);
}

// "A---; B; a" -> "A; B"  (strip dash runs per candidate, dedupe case-insensitively)
function cleanCompany(company: string | null): string | null {
  if (!company) return null;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of company.split(";")) {
    const t = norm(p.replace(/[\s\-–—,]+$/, ""));
    if (t && !seen.has(alnum(t))) { seen.add(alnum(t)); parts.push(t); }
  }
  return orNull(parts.join("; "));
}

function normalizeTitle(job: string | null): string | null {
  if (!job) return null;
  let t = norm(job)
    .replace(/\bSr\.?(?=\s|$)/gi, "Senior")
    .replace(/\bAsstt?\.?(?=\s|$)/gi, "Assistant")
    .replace(/\bDy\.?(?=\s|$)/gi, "Deputy")
    .replace(/\bMgr\.?(?=\s|$)/gi, "Manager");
  const segs: string[] = [];
  for (const s of t.split(/\s+[-–—]+\s+|-{2,}/).map((x) => norm(x.replace(/^[,\-–|]+|[,\-–|]+$/g, "")))) {
    if (s && !segs.some((x) => x.toLowerCase() === s.toLowerCase())) segs.push(s);
  }
  return orNull(segs.join(" - "));
}

// Strip the company from the title only when joined by a connector, as whole words.
function stripCompanyFromJob(job: string | null, company: string | null): string | null {
  if (!job) return null;
  const j = norm(job);
  const c = norm(company?.split(";")[0]);
  if (c.length < 4) return j;
  const co = escapeRe(c);
  const trailing = new RegExp(`\\s*(?:,|-|–|\\||@|\\b(?:of|at|for|in)\\b)\\s*${co}\\s*$`, "i");
  const leading = new RegExp(`^\\s*${co}\\s*(?:,|-|–|\\||:)\\s*`, "i");
  const out = norm(j.replace(trailing, "").replace(leading, "").replace(/[,\-–|]+$/, ""));
  return out.length >= 2 ? out : j;
}

function looksLikePersonName(v: string | null): boolean {
  const n = norm(v);
  if (!n || BUSINESS_WORDS.test(n) || /[\d;\/&]/.test(n)) return false;
  const w = n.split(" ");
  return w.length >= 2 && w.length <= 4 && w.every((x) => /^[A-Z][a-z.]+$/.test(x));
}

function suspicionFlags(f: Fields): string[] {
  const r: string[] = [];
  const n = f.fullName ?? "";
  const c = f.company ?? "";
  if (SOURCE_TAGS.test(n)) r.push("source_tag");
  if (/^\s*DOM/i.test(c)) r.push("source_tag_company");
  if (/\s{2,}/.test(n)) r.push("double_space");
  if (/[\/|,]|\d{3,}|-{2,}|\(|\)/.test(n)) r.push("separator");
  if (BUSINESS_WORDS.test(n)) r.push("business_words_in_name");
  if (wordCount(n) >= 5) r.push("long_name");
  if (/-{2,}|;/.test(c)) r.push("company_junk");
  if (looksLikePersonName(c)) r.push("company_looks_like_person");
  if (/-{2,}/.test(f.jobTitle ?? "")) r.push("job_junk");
  return r;
}

// ---------- LLM ----------

const API_URL = process.env.LLM_API_URL;
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.LLM_MODEL;

interface RawRow extends Fields { id: string; flags: string[] }
interface ParsedRow {
  id: string; fullName: string | null; jobTitle: string | null; company: string | null;
  companyConflict?: boolean; reason?: string; confidence: number;
}

const SYSTEM_PROMPT = `You clean messy CRM contact records (Indian B2B business cards). Each input row has
fullName, jobTitle, company and "flags" describing what looked wrong. Return cleaned values.

Rules:
- fullName must be a HUMAN name or null. Every word of it must appear in the input row (fullName,
  jobTitle or company). Never invent, expand, reorder or "repair" a name. If no human name is
  identifiable, return null.
- Import tags are never part of a name: DOM, EXP, LASER, GMD, T, SOM, Er., Mr., Ms., Sir, Ji.
  Strip them. If the tag text is a company (e.g. LASER), it may be the company.
- "Sri/Shri" is an honorific only before a personal name. "Sri Ram Drum" is a company, so fullName null.
- A fullName that is really a company or a service description (e.g. "ABC LTD---",
  "Transformer, Lt/Ht Overhead Line. Erection/ Commissioning") -> fullName null.
- Composite strings look like Company-Division-Industry-JobTitle-Department. Put the company in
  "company". Put the job title in "jobTitle" and KEEP its department inside it, formatted
  "Title - Department" (e.g. "Manager - Procurement"). Do NOT create separate department or industry
  fields. If division/industry text came with the company, keep it with the company as
  "Company - Division". Do not drop information that was in the input.
- jobTitle format: Senior, Assistant, Deputy, Manager (no Sr./Asstt./Dy./Mgr.). If the input has
  no job title, return the existing jobTitle unchanged.
- company: several candidates separated by ";" -> choose the most complete, formal one. If the existing
  company is already a clean real company and the name string mentions a DIFFERENT company, keep the
  existing company and set companyConflict=true. If you cannot determine the company, return the
  existing value unchanged.

Examples:
 "EXP  Daha Diop"                          -> fullName "Daha Diop"
 "LASER  Akansha Singh"                    -> fullName "Akansha Singh", company "LASER"
 "DOM GMD  Gorakshanath Construction"      -> fullName null, company "Gorakshanath Construction"
 "NCC LIMITED-Water-Contracts-HOD"         -> company "NCC LIMITED - Water", jobTitle "HOD - Contracts"
 "Sri ram drum jamshedpur"                 -> fullName null, company "Sri Ram Drum Jamshedpur"
 "SRI SURAJ KUMAR SHARMAH---"              -> fullName "Suraj Kumar Sharmah"
 "Abss Meera Luharka" + company "ABB; Teckno Power Enterprises Kolkotta" -> fullName "Meera Luharka"

Return ONLY JSON: {"rows":[{"id":"...","fullName":string|null,"jobTitle":string|null,
"company":string|null,"companyConflict":boolean,"reason":"short","confidence":0..1}]}`;

async function callLLM(rows: RawRow[]): Promise<ParsedRow[]> {
  if (!API_URL) throw new Error("Missing LLM_API_URL environment variable.");
  if (!API_KEY) throw new Error("Missing OPENAI_API_KEY environment variable.");
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(rows) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) throw new Error(`LLM API error: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const text = (data.choices?.[0]?.message?.content ?? "{}").replace(/```json|```/g, "").trim();
  try {
    const result = JSON.parse(text);
    const parsed = result.rows ?? result.results ?? result.data ?? (Array.isArray(result) ? result : []);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    const sent = new Set(rows.map((r) => r.id));
    return parsed.filter((p: ParsedRow) => sent.has(p.id));
  } catch {
    console.error("Failed to parse LLM response:", text.slice(0, 300));
    return [];
  }
}

// skipped rows are retried one at a time
async function classifyBatch(rows: RawRow[]): Promise<ParsedRow[]> {
  const got = await callLLM(rows);
  const done = new Set(got.map((g) => g.id));
  const missing = rows.filter((r) => !done.has(r.id));
  if (missing.length) console.warn(`  ${missing.length} rows missing, retrying individually`);
  for (const m of missing) {
    try { got.push(...(await callLLM([m]))); } catch (e) { console.error("  retry failed", m.id, e); }
  }
  return got;
}

const chunk = <T,>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

// ---------- guards ----------

// returns a rejection reason, or null if the result may be applied
function guard(raw: RawRow, r: ParsedRow): string | null {
  if ((r.confidence ?? 0) < MIN_CONFIDENCE) return `low_confidence(${r.confidence})`;

  if (r.fullName) {
    const hay = alnum(`${raw.fullName} ${raw.company} ${raw.jobTitle}`);
    const invented = r.fullName.split(/\s+/).filter((w) => alnum(w).length > 1 && !hay.includes(alnum(w)));
    if (invented.length) return `invented_name(${invented.join(",")})`;
  }

  const curClean = raw.company && !raw.flags.some((f) => f.startsWith("company") || f === "source_tag_company");
  const changed = r.company && alnum(r.company) !== alnum(raw.company);
  if (curClean && changed && !alnum(r.company!).includes(alnum(raw.company))) {
    return "company_conflict";
  }
  return null;
}

// ---------- main ----------

async function main() {
  const contacts = await prisma.contact.findMany({
    select: { id: true, fullName: true, jobTitle: true, company: true },
  });
  console.log(`Loaded ${contacts.length} rows.${DRY_RUN ? " (dry run)" : ""}${NO_LLM ? " (no LLM)" : ""}`);

  const original = new Map<string, Fields>();
  const current = new Map<string, Fields>();
  const queue: RawRow[] = [];

  for (const c of contacts) {
    original.set(c.id, { fullName: c.fullName, jobTitle: c.jobTitle, company: c.company });

    const company = cleanCompany(c.company);
    const fullName = cleanPersonName(c.fullName);
    const jobTitle = normalizeTitle(stripCompanyFromJob(c.jobTitle, company));
    current.set(c.id, { fullName, jobTitle, company });

    // flags are computed on the ORIGINAL values so removed junk is still visible to the LLM
    const flags = suspicionFlags({ fullName: c.fullName, jobTitle: c.jobTitle, company: c.company });
    if (flags.length) queue.push({ id: c.id, fullName: c.fullName, jobTitle: c.jobTitle, company: c.company, flags });
  }
  console.log(`Rows queued for LLM: ${queue.length}`);

  let applied = 0, rejected = 0;
  if (!NO_LLM) {
    const batches = chunk(queue.slice(0, LIMIT), BATCH);
    const rawById = new Map(queue.map((q) => [q.id, q]));
    for (let i = 0; i < batches.length; i++) {
      console.log(`LLM batch ${i + 1}/${batches.length}...`);
      let results: ParsedRow[] = [];
      try { results = await classifyBatch(batches[i]); }
      catch (e) { console.error(`batch ${i + 1} failed:`, e); continue; }

      for (const r of results) {
        const raw = rawById.get(r.id)!;
        const cur = current.get(r.id)!;
        const why = guard(raw, r);
        if (why) {
          rejected++;
          audit.record(r.id, "__review__", `${why}: ${JSON.stringify(original.get(r.id))}`, JSON.stringify(r));
          continue;
        }
        current.set(r.id, {
          fullName: cleanPersonName(r.fullName?.replace(SOURCE_TAGS, "") ?? null), // null allowed
          jobTitle: normalizeTitle(r.jobTitle) ?? cur.jobTitle,
          company: cleanCompany(r.company) ?? cur.company,
        });
        applied++;
      }
    }
  }

  // diff vs ORIGINAL DB values, log only real changes, persist
  let changedRows = 0;
  const counts = { fullName: 0, jobTitle: 0, company: 0 };
  for (const [id, before] of original) {
    const after = current.get(id)!;
    const data: Partial<Fields> = {};
    for (const f of ["fullName", "jobTitle", "company"] as const) {
      if ((before[f] ?? null) !== (after[f] ?? null)) {
        data[f] = after[f];
        counts[f]++;
        audit.record(id, f, before[f], after[f]);
      }
    }
    if (Object.keys(data).length) {
      changedRows++;
      if (!DRY_RUN) await prisma.contact.update({ where: { id }, data });
    }
  }

  const summary =
    `Rows changed: ${changedRows} (fullName ${counts.fullName}, jobTitle ${counts.jobTitle}, company ${counts.company}). ` +
    `Queued ${queue.length}, LLM applied ${applied}, sent to review ${rejected}.`;
  console.log(summary);
  audit.logRun(summary);
  if (DRY_RUN) console.log("Dry run - no database writes were made.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { audit.write(); prisma.$disconnect(); });