/**
 * Pure composite-string parser for the DB cleanup scripts.
 *
 * No Prisma, no network, no filesystem, no LLM. Deterministic so the cleanup
 * scripts can be re-run and unit-tested.
 *
 * Splits a dash-joined Company-Division-Industry-Title-Department string into
 * fields. Per D1 the division is appended to the company AND returned
 * separately; the department stays inside the job title.
 */

import { norm } from "@/lib/cleaning/text";
import { normalizeTitle } from "@/lib/cleaning/job";

export interface CompositeParse {
  company: string | null;
  jobTitle: string | null;
  division: string | null;
  confidence: "high" | "low";
  segments: string[];
}

/** Role-title lexicon. */
const TITLE_RE =
  /\b(manager|director|officer|executive|engineer|head|chief|ceo|md|gm|agm|dgm|hod|co-?ordinator|proprietor|partner|president|chairman|consultant|supervisor|lead|analyst|deputy|assistant|secretary|treasurer|founder|owner|in-?charge|vp|vice|sr|senior)\b/i;

/** Division suffix markers. */
const DIVISION_SUFFIX = /(?:division|dept|department|sbu|unit)$/i;

/** Small explicit division lexicon. */
const DIVISION_LIST = new Set([
  "water",
  "water division",
  "railway",
  "power distribution",
  "epc contractor",
]);

function isTitle(seg: string): boolean {
  return TITLE_RE.test(seg);
}

function isDivision(seg: string): boolean {
  const s = seg.toLowerCase();
  return DIVISION_SUFFIX.test(s) || DIVISION_LIST.has(s);
}

/**
 * Parse a composite string, or return null for a blank input.
 *
 * The first non-empty segment is the company. Division segments are appended
 * to the company and returned separately. A segment right after a title that is
 * neither title nor division is the department. Confidence is "high" only for
 * exactly one company segment with at most one title segment.
 */
export function parseComposite(value: string): CompositeParse | null {
  const raw = norm(value);
  if (!raw) return null;

  const segments = raw
    .split(/-+/)
    .map((part) => norm(part))
    .filter(Boolean);
  if (!segments.length) return null;

  let company: string | null = null;
  const divisions: string[] = [];
  const titles: string[] = [];
  let department: string | null = null;
  let companyCount = 0;
  let seenTitle = false;
  let seenDepartment = false;

  for (const seg of segments) {
    if (isTitle(seg)) {
      titles.push(seg);
      seenTitle = true;
      continue;
    }
    if (isDivision(seg)) {
      divisions.push(seg);
      continue;
    }
    if (seenTitle && !seenDepartment && company !== null) {
      department = seg;
      seenDepartment = true;
      continue;
    }
    if (company === null) {
      company = seg;
    }
    companyCount++;
  }

  const companyOut =
    company === null ? null : [company, ...divisions].join(" - ");

  let jobTitle: string | null = null;
  if (titles.length) {
    const titleText = titles
      .map((t) => normalizeTitle(t) ?? norm(t))
      .join(" - ");
    jobTitle = department ? `${titleText} - ${norm(department)}` : titleText;
  }

  const division = divisions.length ? divisions.join(" - ") : null;
  const confidence: "high" | "low" =
    companyCount === 1 && titles.length <= 1 ? "high" : "low";

  return { company: companyOut, jobTitle, division, confidence, segments };
}
