// scripts/clean-name-job-company.ts
//
// Cleans fullName, jobTitle and company on Contact.
//
// Tiers:
//  1. Free rules (always run, applied to every row, persisted to DB):
//     - fullName: strip honorific suffix (Sir/Ji/...) and prefix (Mr./Shri/...), collapse spaces
//     - jobTitle: strip the company name only when attached via a separator/connector
//     - company: trim trailing dashes/commas/semicolons, collapse spaces
//  2. LLM "junk" queue: dash-separated composite strings / multi-candidate companies
//  3. LLM "mashup" queue: "DOM " prefix, "A / B" slash mashups, business words inside
//     fullName, comma descriptions, 5+ word names. A real person name is usually present.
//
// Flags:
//   --dry-run     no DB writes (LLM still runs so the log shows real results)
//   --no-llm      skip LLM entirely (rules only, free)
//   --limit=N     cap rows per LLM queue (use with --dry-run to sample)

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ScriptAudit } from "../lib/scriptAudit";

const DRY_RUN = process.argv.includes("--dry-run");
const NO_LLM = process.argv.includes("--no-llm");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity;
const MIN_CONFIDENCE = 0.7;
const audit = new ScriptAudit("clean-name-job-company", DRY_RUN);

// ---------- helpers ----------

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const orNull = (s: string) => (s ? s : null);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HONORIFIC_SUFFIX = /\s+(sir|ji|saab|sahab|saheb|madam|maam|mam)\.?\s*$/i;
const HONORIFIC_PREFIX = /^\s*(mr|mrs|ms|shri|shree|sri|smt)\.?\s+/i;

function cleanPersonName(name: string | null): string | null {
  if (!name) return null;
  let n = norm(name);
  const stripped = norm(n.replace(HONORIFIC_SUFFIX, "").replace(HONORIFIC_PREFIX, ""));
  n = stripped || n; // never reduce a name to empty
  return orNull(n);
}

function cleanCompany(company: string | null): string | null {
  if (!company) return null;
  return orNull(norm(company.replace(/[\s\-–—,;]+$/, "")));
}

// Only strips the company when it is attached to the role via a connector/separator,
// as whole words. "CEO and proprietor of Rashmi Electricals" -> "CEO and proprietor",
// "GOVT LICENSED ELECTRICAL CONTRACTOR" is left alone.
function stripCompanyFromJob(job: string | null, company: string | null): string | null {
  if (!job) return null;
  const j = norm(job);
  const c = norm(company);
  if (c.length < 4) return j;
  const co = escapeRe(c);
  const trailing = new RegExp(`\\s*(?:,|-|–|\\||@|\\b(?:of|at|for|in)\\b)\\s*${co}\\s*$`, "i");
  const leading = new RegExp(`^\\s*${co}\\s*(?:,|-|–|\\||:)\\s*`, "i");
  const out = norm(j.replace(trailing, "").replace(leading, "").replace(/[,\-–|]+$/, ""));
  return out.length >= 2 ? out : j;
}

function looksLikeDashJunk(v: string | null): boolean {
  if (!v) return false;
  return /-{2,}/.test(v) || v.split("-").length >= 4;
}
const hasMultiCandidateCompany = (v: string | null) => !!v && v.split(";").length > 1;
const looksLikeDom = (v: string | null) => !!v && /^\s*DOM\b/i.test(v);

const BUSINESS_WORDS =
  /\b(pvt|ltd|llp|enterprises?|engineers?|engineering|traders?|electricals?|constructions?|infra\w*|industries|associates|contractors?|services|solutions|works|corporation|corp|company|printers?|transformers?|erection|commissioning)\b/i;

function looksLikeMashup(name: string | null): boolean {
  if (!name) return false;
  return (
    /[\/|]/.test(name) ||
    name.includes(",") ||
    /\d{3,}/.test(name) ||
    BUSINESS_WORDS.test(name) ||
    norm(name).split(" ").length >= 5
  );
}

// ---------- LLM ----------

const API_URL = process.env.LLM_API_URL;
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.LLM_MODEL;

interface RawRow { id: string; fullName: string | null; jobTitle: string | null; company: string | null }
interface ParsedRow {
  id: string; fullName: string | null; jobTitle: string | null; company: string | null;
  division: string | null; industry: string | null; confidence: number;
}

const SHAPE = `Return ONLY a JSON object, nothing else:
{"rows": [{"id": "...", "fullName": string|null, "jobTitle": string|null, "company": string|null,
  "division": string|null, "industry": string|null, "confidence": number}]}
confidence is 0 to 1. If you cannot determine the company, return the existing company value
unchanged. If there is no job title in the input, return the existing jobTitle unchanged.`;

const JUNK_SYSTEM_PROMPT = `You clean up messy CRM contact records. fullName and/or company may hold a
raw composite string with dash-separated segments, roughly:
  CompanyName - Division/BusinessType - Industry - JobTitle - Department
Segments can be empty (e.g. "ABC LTD---"), reordered, or missing. company may also hold several
candidate names separated by semicolons - pick the most complete/formal one.
Return the real company, the job title if present, and division/industry if present. There is
usually NO person's name in this junk - only set fullName if an actual human name is identifiable.
Never invent a name. Strip honorifics like Sir/Ji/Mr from any name you return.
${SHAPE}`;

const MASHUP_SYSTEM_PROMPT = `You clean up messy CRM contact records. fullName holds a person's name
mashed together with company/business text, in no fixed order, separated by "-", "/", "," or nothing.
It may start with a literal "DOM" tag (import artifact - always strip it). Examples:
  "DOM Ashoka Buildcon - Rahul Bhagwat" -> company "Ashoka Buildcon", fullName "Rahul Bhagwat"
  "DOM Bharat Kumar Sahoo Bks Ent"      -> fullName "Bharat Kumar Sahoo", company "Bks Ent"
  "DOM BHS - Amar Mishra"               -> company "BHS", fullName "Amar Mishra"
  "LASER / Sanjeev Chaddha Sir"         -> company "LASER", fullName "Sanjeev Chaddha"
  "Transformer, Lt/Ht Overhead Line. Erection/ Commissioning" -> no person: fullName null,
     the text describes services (put it in industry, not company, unless it is clearly a company)
A real person's name is usually present - extract it into fullName. Set fullName null only if no
human name is identifiable. Strip honorifics (Sir, Ji, Mr, Shri). Use the existing company and
jobTitle fields as a cross-check for which part is the company.
${SHAPE}`;

async function callLLM(rows: RawRow[], systemPrompt: string): Promise<ParsedRow[]> {
  if (!API_URL) throw new Error("Missing LLM_API_URL environment variable.");
  if (!API_KEY) throw new Error("Missing OPENAI_API_KEY environment variable.");
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
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

// one retry for rows the model skipped
async function classifyBatch(rows: RawRow[], prompt: string): Promise<ParsedRow[]> {
  const got = await callLLM(rows, prompt);
  const done = new Set(got.map((g) => g.id));
  const missing = rows.filter((r) => !done.has(r.id));
  if (!missing.length) return got;
  console.warn(`  ${missing.length} rows missing, retrying once`);
  return [...got, ...(await callLLM(missing, prompt))];
}

const chunk = <T,>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

async function runQueue(label: string, rows: RawRow[], prompt: string): Promise<ParsedRow[]> {
  const out: ParsedRow[] = [];
  const batches = chunk(rows.slice(0, LIMIT), 25);
  for (let i = 0; i < batches.length; i++) {
    console.log(`${label} batch ${i + 1}/${batches.length}...`);
    try { out.push(...(await classifyBatch(batches[i], prompt))); }
    catch (e) { console.error(`${label} batch ${i + 1} failed:`, e); }
  }
  return out;
}

// ---------- main ----------

type Fields = { fullName: string | null; jobTitle: string | null; company: string | null };

async function main() {
  const contacts = await prisma.contact.findMany({
    select: { id: true, fullName: true, jobTitle: true, company: true },
  });
  console.log(`Loaded ${contacts.length} rows.${DRY_RUN ? " (dry run)" : ""}${NO_LLM ? " (no LLM)" : ""}`);

  const original = new Map<string, Fields>();
  const current = new Map<string, Fields>(); // after rules, updated again after LLM
  const junkRows: RawRow[] = [];
  const mashupRows: RawRow[] = [];

  for (const c of contacts) {
    original.set(c.id, { fullName: c.fullName, jobTitle: c.jobTitle, company: c.company });

    const company = cleanCompany(c.company);
    const fullName = cleanPersonName(c.fullName);
    const jobTitle = stripCompanyFromJob(c.jobTitle, company);
    current.set(c.id, { fullName, jobTitle, company });

    const row = { id: c.id, fullName, jobTitle, company };
    if (looksLikeDom(fullName) || looksLikeDom(company) || looksLikeMashup(fullName)) {
      // a real person name is usually in here, so it must not go to the junk (null-the-name) prompt
      mashupRows.push(row);
      continue;
    }
    if (looksLikeDashJunk(fullName) || looksLikeDashJunk(company) || hasMultiCandidateCompany(company)) {
      junkRows.push(row);
    }
  }

  console.log(`Junk rows queued: ${junkRows.length}, mashup rows queued: ${mashupRows.length}`);

  let junkResults: ParsedRow[] = [];
  let mashupResults: ParsedRow[] = [];
  if (!NO_LLM) {
    junkResults = await runQueue("Junk", junkRows, JUNK_SYSTEM_PROMPT);
    mashupResults = await runQueue("Mashup", mashupRows, MASHUP_SYSTEM_PROMPT);
  }

  // merge LLM output into current, gated by confidence; never overwrite with empty values
  let applied = 0, lowConfidence = 0;
  for (const [queue, results] of [["junk", junkResults], ["mashup", mashupResults]] as const) {
    for (const r of results) {
      const cur = current.get(r.id)!;
      if ((r.confidence ?? 0) < MIN_CONFIDENCE) {
        lowConfidence++;
        audit.record(r.id, "__review__", `${queue}: ${JSON.stringify(cur)}`, JSON.stringify(r));
        continue;
      }
      current.set(r.id, {
        fullName: cleanPersonName(r.fullName?.replace(/^\s*DOM\b\s*/i, "") ?? null), // null allowed: no real name
        jobTitle: orNull(norm(r.jobTitle)) ?? cur.jobTitle,
        company: cleanCompany(r.company) ?? cur.company,
      });
      applied++;
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
    `Junk queued ${junkRows.length}, mashup queued ${mashupRows.length}, LLM applied ${applied}, low-confidence ${lowConfidence}.`;
  console.log(summary);
  audit.logRun(summary);
  if (DRY_RUN) console.log("Dry run - no database writes were made.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { audit.write(); prisma.$disconnect(); });