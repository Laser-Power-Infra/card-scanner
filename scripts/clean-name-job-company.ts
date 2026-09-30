// scripts/clean-name-job-company.ts
//
// Fixes THREE categories of issues found in fullName / jobTitle / company:
//
// 1. Rule-based, free, no LLM needed:
//    - Stray honorific words stuck on the end of fullName ("... Sir")
//    - jobTitle that just embeds the company name verbatim
//      (e.g. "Proprietor, Singhal Printers" when company = "Singhal Printers")
//
// 2. Composite dash-junk rows (queue: "junk"), sent to an LLM in batches:
//    fullName and/or company holding a raw record like
//      "ADITYA ENTERPRISES-EPC Contractor-Railway-MD-Purchase"
//      "ABN Tower and Transmission Private Limited---"
//    These get parsed into company / jobTitle / division / industry.
//    There is usually NO real person's name in these - fullName is set to
//    null unless a real human name is actually identifiable.
//
// 3. "DOM "-prefixed rows (queue: "dom"), sent to a DIFFERENT LLM prompt:
//    fullName looks like "DOM Ashoka Buildcon - Rahul Bhagwat" or
//    "DOM Bharat Kumar Sahoo Bks Ent" - a real person's name IS usually
//    present here, mashed together with a company name, in no fixed order
//    or separator. These need company and person name split out, not nulled.
//
// Always backs up original values to a JSON file before writing anything.
// Run with --dry-run first (skips LLM calls entirely, costs nothing).

import "dotenv/config";
import { prisma } from "../lib/prisma";
import * as fs from "fs";

const DRY_RUN = process.argv.includes("--dry-run");

// ---------- Step 1: rule-based fixes (no LLM, no cost) ----------

const HONORIFIC_SUFFIX = /\s+(sir|ji|madam|maam)\.?\s*$/i;

function stripHonorificSuffix(name: string): string {
  return name.replace(HONORIFIC_SUFFIX, "").trim();
}

function jobTitleEmbedsCompany(job: string, company: string): boolean {
  if (!job || !company || company.length < 4) return false;
  return job.toLowerCase().includes(company.toLowerCase());
}

// ---------- Step 2: detect composite dash-junk pattern ----------

function looksLikeDashJunk(value: string | null): boolean {
  if (!value) return false;
  // 2+ consecutive dashes (e.g. "---", "--") OR 4+ single-dash-separated segments
  if (/-{2,}/.test(value)) return true;
  const segments = value.split("-");
  return segments.length >= 4;
}

function hasMultiCandidateCompany(value: string | null): boolean {
  if (!value) return false;
  return value.includes(";") && value.split(";").length > 1;
}

// ---------- Step 3: detect "DOM "-prefixed person+company mashup ----------

function looksLikeDomPrefixed(value: string | null): boolean {
  if (!value) return false;
  return /^\s*DOM\b/i.test(value);
}

// ---------- Step 4: LLM batch parsing ----------
// Uses a generic OpenAI-compatible chat completions endpoint.

const API_URL = process.env.LLM_API_URL;
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.LLM_MODEL;

interface RawRow {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
}

interface ParsedRow {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  company: string;
  division: string | null;
  industry: string | null;
  confidence: number;
}

const JUNK_SYSTEM_PROMPT = `You clean up messy CRM contact records. Each record's fullName and/or
company field may contain a raw composite string with dash-separated segments in this
rough shape:

  CompanyName - Division/BusinessType - Industry - JobTitle - Department

Segments can be empty (shown as consecutive dashes, e.g. "ABC LTD---"), out of the exact
order above, or missing entirely. The company field may also contain multiple candidate
company names separated by semicolons - pick the most complete/formal-looking one.

For each input row, return the real company name, the job title if one is present in the
segments, and the division/industry if present. There is usually NO real person's name in
this junk string - only set fullName if you can identify an actual human name in the
original fullName field. Never invent a person's name.

Return ONLY a JSON object with exactly this shape and nothing else:
{"rows": [{"id": "...", "fullName": string|null, "jobTitle": string|null, "company": string,
  "division": string|null, "industry": string|null, "confidence": number}]}

confidence is 0 to 1: how sure you are the parse is correct.`;

const DOM_SYSTEM_PROMPT = `You clean up messy CRM contact records. Each record's fullName field
starts with a literal "DOM" tag (an artifact of the import source - always strip it) followed by
a company name and a person's name mashed together, in NO fixed order and often with no
separator, or a "-" separator in either direction. Examples:

  "DOM Ashoka Buildcon - Rahul Bhagwat"    -> company: "Ashoka Buildcon", person: "Rahul Bhagwat"
  "DOM Akhilesh Kumar Pandey"              -> person: "Akhilesh Kumar Pandey", company: unclear from this field alone
  "DOM Bharat Kumar Sahoo Bks Ent"         -> person: "Bharat Kumar Sahoo", company: "Bks Ent"
  "DOM BHS - Amar Mishra"                  -> company: "BHS", person: "Amar Mishra"

Unlike other junk patterns, a REAL PERSON'S NAME IS USUALLY PRESENT here - extract it into
fullName rather than nulling it. Only set fullName to null if no human name is genuinely
identifiable in the string. Use the existing company field (also provided) as a cross-check
for which part of the string is the company.

Return ONLY a JSON object with exactly this shape and nothing else:
{"rows": [{"id": "...", "fullName": string|null, "jobTitle": string|null, "company": string,
  "division": string|null, "industry": string|null, "confidence": number}]}

confidence is 0 to 1: how sure you are the parse is correct.`;

async function classifyBatch(rows: RawRow[], systemPrompt: string): Promise<ParsedRow[]> {
  if (!API_URL) throw new Error("Missing LLM_API_URL environment variable.");
  if (!API_KEY) throw new Error("Missing OPENAI_API_KEY environment variable.");

  const userPayload = rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    jobTitle: r.jobTitle,
    company: r.company,
  }));

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();

  let parsed: ParsedRow[];
  try {
    const result = JSON.parse(cleaned);
    // response_format: json_object forces an object wrapper - the model can pick
    // any key name for it, so check the common ones rather than assuming "rows".
    parsed = result.rows ?? result.results ?? result.data ?? (Array.isArray(result) ? result : []);
    if (!Array.isArray(parsed)) {
      console.error("Unexpected LLM response shape:", cleaned.slice(0, 500));
      return [];
    }
  } catch (e) {
    console.error("Failed to parse LLM response for batch:", cleaned.slice(0, 500));
    return [];
  }

  const sentIds = new Set(rows.map((r) => r.id));
  const accepted = parsed.filter((p) => sentIds.has(p.id));
  const missing = rows.filter((r) => !accepted.some((p) => p.id === r.id));
  if (missing.length) {
    console.warn(`  ${missing.length} rows in this batch got no valid LLM result:`, missing.map((r) => r.id));
  }
  return accepted;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------- Main ----------

async function main() {
  const contacts = await prisma.contact.findMany({
    select: { id: true, fullName: true, jobTitle: true, company: true },
  });

  console.log(`Loaded ${contacts.length} rows.${DRY_RUN ? " (dry run)" : ""}`);

  const backup: RawRow[] = [];
  const ruleFixes: { id: string; before: RawRow; after: Partial<RawRow> }[] = [];
  const junkRows: RawRow[] = [];
  const domRows: RawRow[] = [];

  for (const c of contacts) {
    let fullName = c.fullName;
    let jobTitle = c.jobTitle;
    const company = c.company;
    let changed = false;

    // Rule 1: strip honorific suffix
    if (fullName) {
      const stripped = stripHonorificSuffix(fullName);
      if (stripped !== fullName) {
        fullName = stripped;
        changed = true;
      }
    }

    // Rule 2: jobTitle that's just "<role>, <company name>" - trim the company part
    if (jobTitle && company && jobTitleEmbedsCompany(jobTitle, company)) {
      const trimmed = jobTitle
        .replace(new RegExp(`,?\\s*${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), "")
        .trim();
      if (trimmed && trimmed !== jobTitle) {
        jobTitle = trimmed;
        changed = true;
      }
    }

    if (changed) {
      backup.push({ id: c.id, fullName: c.fullName, jobTitle: c.jobTitle, company: c.company });
      ruleFixes.push({
        id: c.id,
        before: { id: c.id, fullName: c.fullName, jobTitle: c.jobTitle, company: c.company },
        after: { fullName, jobTitle },
      });
    }

    // Check DOM-prefix pattern FIRST (it's more specific and needs different handling)
    if (looksLikeDomPrefixed(fullName) || looksLikeDomPrefixed(company)) {
      domRows.push({ id: c.id, fullName, jobTitle, company });
      continue; // don't also queue it as generic dash-junk
    }

    // Then check generic dash-junk / multi-candidate pattern
    if (
      (fullName && looksLikeDashJunk(fullName)) ||
      (company && looksLikeDashJunk(company)) ||
      hasMultiCandidateCompany(company)
    ) {
      junkRows.push({ id: c.id, fullName, jobTitle, company });
    }
  }

  console.log(`Rule-based fixes: ${ruleFixes.length}`);
  console.log(`Dash-junk rows queued: ${junkRows.length}`);
  console.log(`DOM-prefixed rows queued: ${domRows.length}`);

  // Apply rule-based fixes
  if (!DRY_RUN) {
    for (const fix of ruleFixes) {
      await prisma.contact.update({ where: { id: fix.id }, data: fix.after });
    }
  }

  // Run LLM batch passes
  const junkResults: ParsedRow[] = [];
  const domResults: ParsedRow[] = [];

  const junkBatches = chunk(junkRows, 25);
  const domBatches = chunk(domRows, 25);

  for (let i = 0; i < junkBatches.length; i++) {
    console.log(`Junk batch ${i + 1}/${junkBatches.length}...`);
    if (DRY_RUN) continue;
    try {
      junkResults.push(...(await classifyBatch(junkBatches[i], JUNK_SYSTEM_PROMPT)));
    } catch (e) {
      console.error(`Junk batch ${i + 1} failed:`, e);
    }
  }

  for (let i = 0; i < domBatches.length; i++) {
    console.log(`DOM batch ${i + 1}/${domBatches.length}...`);
    if (DRY_RUN) continue;
    try {
      domResults.push(...(await classifyBatch(domBatches[i], DOM_SYSTEM_PROMPT)));
    } catch (e) {
      console.error(`DOM batch ${i + 1} failed:`, e);
    }
  }

  const allResults = [...junkResults, ...domResults];

  if (!DRY_RUN) {
    for (const c of [...junkRows, ...domRows]) backup.push(c);
    for (const r of allResults) {
      await prisma.contact.update({
        where: { id: r.id },
        data: {
          fullName: r.fullName, // null only when no real person name exists
          jobTitle: r.jobTitle,
          company: r.company,
        },
      });
    }
    console.log(`LLM-parsed rows written: ${allResults.length} (junk: ${junkResults.length}, dom: ${domResults.length})`);
  }

  // Write backup + reports
  fs.writeFileSync("name-job-company-backup.json", JSON.stringify(backup, null, 2));
  fs.writeFileSync("rule-fixes-report.json", JSON.stringify(ruleFixes, null, 2));
  fs.writeFileSync("dash-junk-queue.json", JSON.stringify(junkRows, null, 2));
  fs.writeFileSync("dom-prefix-queue.json", JSON.stringify(domRows, null, 2));
  if (allResults.length) {
    fs.writeFileSync("llm-parsed-results.json", JSON.stringify(allResults, null, 2));
  }

  console.log("\nBackup and reports written:");
  console.log("  name-job-company-backup.json  (original values for every changed row)");
  console.log("  rule-fixes-report.json        (before/after for rule-based fixes)");
  console.log("  dash-junk-queue.json          (rows flagged for the junk-pattern LLM pass)");
  console.log("  dom-prefix-queue.json         (rows flagged for the DOM-prefix LLM pass)");
  if (allResults.length) console.log("  llm-parsed-results.json       (LLM output before writing)");

  if (DRY_RUN) {
    console.log("\nDry run only - no database writes were made, and no LLM calls were sent.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());