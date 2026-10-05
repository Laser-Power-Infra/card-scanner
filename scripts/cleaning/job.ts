/**
 * Pure job-title cleaning helpers for the DB cleanup scripts.
 *
 * No Prisma, no network, no filesystem, no LLM. Every function is
 * deterministic so the cleanup scripts can be re-run and unit-tested.
 *
 * Reuses `norm` from ./text rather than re-implementing whitespace handling.
 */

import { norm } from "./text";

/**
 * Common prefixes whose hyphen joins a single compound word (Co-Ordinator,
 * Re-Engineer, ...). A hyphen run after one of these is left untouched; every
 * other hyphen run is treated as a segment separator and spaced.
 */
const HYPHEN_PREFIXES = new Set([
  "co",
  "re",
  "self",
  "vice",
  "multi",
  "non",
  "pre",
  "post",
  "anti",
  "semi",
  "sub",
  "super",
  "inter",
  "intra",
  "trans",
  "ex",
  "well",
  "all",
  "in",
  "on",
  "cross",
]);

/** Acronyms preserved verbatim when title-casing a lowercase-start title. */
const ACRONYMS = new Set(["HOD", "DGM", "AGM", "GM", "MD", "CEO"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collapse an exactly-doubled leading block: "A B A B" -> "A B". */
function collapseRepeats(s: string): string {
  let tokens = s.split(" ").filter(Boolean);
  let changed = true;
  while (changed && tokens.length > 0 && tokens.length % 2 === 0) {
    changed = false;
    const half = tokens.length / 2;
    const head = tokens.slice(0, half).join(" ").toLowerCase();
    const tail = tokens.slice(half).join(" ").toLowerCase();
    if (head === tail) {
      tokens = tokens.slice(0, half);
      changed = true;
    }
  }
  return tokens.join(" ");
}

/** Title-case a lowercase-start title while preserving known acronyms. */
function titleCase(s: string): string {
  return s
    .split(" ")
    .map((word) => {
      if (!word || word === "-") return word;
      if (ACRONYMS.has(word.toUpperCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Expand role abbreviations, normalize separators, dedupe repeated segments,
 * unwrap parentheses, and title-case a lowercase-start title.
 *
 * Department text stays inside the title (D1): Manager-Procurement becomes
 * "Manager - Procurement", not split into fields. Returns null for null/blank.
 */
export function normalizeTitle(job: string | null): string | null {
  const base = norm(job);
  if (!base) return null;

  let s = base;

  // Unwrap a single pair of wrapping parentheses.
  s = s.replace(/^\(\s*(.*?)\s*\)$/, "$1");

  // Abbreviation expansion (word-boundary, case-insensitive).
  s = s.replace(/\bSr\.?(?=\s|$)/gi, "Senior");
  s = s.replace(/\bAsstt?\.?(?=\s|$)/gi, "Assistant");
  s = s.replace(/\bDy\.?(?=\s|$)/gi, "Deputy");
  s = s.replace(/\bMgr\.?(?=\s|$)/gi, "Manager");

  // Pipe separators normalize to " - ".
  s = s.replace(/\s*\|\s*/g, " - ");

  // Hyphen runs become " - " unless they join a known compound word.
  s = s.replace(
    /([A-Za-z]+)(-+)([A-Za-z]+)/g,
    (match, before: string, _dashes: string, after: string) =>
      HYPHEN_PREFIXES.has(before.toLowerCase())
        ? match
        : `${before} - ${after}`,
  );
  s = norm(s);

  // Dedupe repeated " - " segments (consecutive, case-insensitive).
  const segs = s.split(/\s+-\s+/);
  const kept: string[] = [];
  for (const seg of segs) {
    const clean = norm(seg);
    if (!clean) continue;
    if (kept.length && kept[kept.length - 1].toLowerCase() === clean.toLowerCase()) {
      continue;
    }
    kept.push(clean);
  }
  s = kept.join(" - ");

  s = collapseRepeats(s);
  if (/^[a-z]/.test(s)) s = titleCase(s);

  s = s.replace(/[\s,;.\-]+$/g, "");
  return norm(s) || null;
}

/**
 * Strip a company name from a job string, but ONLY when the company is joined
 * at the very start or end by a separator/connector as a whole token.
 *
 * A company that only appears as a mid-string substring is never removed.
 */
export function stripCompanyFromJob(
  job: string | null,
  company: string | null,
): string {
  const j = norm(job);
  const c = norm(company);
  if (!j || !c) return j;

  const esc = escapeRegExp(c);

  if (new RegExp(`^${esc}$`, "i").test(j)) return "";

  const startRe = new RegExp(
    `^${esc}\\s*(?:[,|@\\-]|\\bof\\b|\\bat\\b|\\bfor\\b|\\bin\\b)\\s+`,
    "i",
  );
  if (startRe.test(j)) return norm(j.replace(startRe, ""));

  const endRe = new RegExp(
    `\\s+(?:[,|@\\-]|\\bof\\b|\\bat\\b|\\bfor\\b|\\bin\\b)\\s*${esc}$`,
    "i",
  );
  if (endRe.test(j)) return norm(j.replace(endRe, ""));

  return j;
}

/** Credential tokens detected by extractQualifications, longest-first. */
const CREDENTIALS = [
  "B\\.?\\s*Bc\\.?\\s*Engr",
  "Chartered\\s+Engineer",
  "B\\.?\\s*Tech",
  "M\\.?\\s*Tech",
  "B\\.?\\s*Sc",
  "M\\.?\\s*Sc",
  "B\\.?\\s*Com",
  "B\\.?\\s*E",
  "M\\.?\\s*E",
  "B\\.?\\s*A",
  "M\\.?\\s*A",
  "PGD[AM]?",
  "Ph\\.?\\s*D",
  "AMIE",
  "MIE",
  "MBA",
  "F\\s*\\([^)]+\\)",
].join("|");

const QUAL_RE = new RegExp(
  `(?:^|[\\s,;])((?:${CREDENTIALS})(?:\\([^)]*\\))?)(?=[\\s,;.\\-]|$)`,
  "gi",
);

/** Words that make the residual text read as a role rather than a field name. */
const ROLE_WORDS =
  /\b(manager|director|officer|executive|engineer|head|chief|ceo|md|gm|agm|dgm|hod|co-?ordinator|proprietor|partner|president|chairman|consultant|supervisor|lead|analyst|deputy|assistant|secretary|treasurer|founder|owner|in-?charge|vp|vice)\b/i;

/**
 * Split a job string into the remaining role text and the credential groups
 * found in it. Credential groups (with any parenthesised specialisation) are
 * removed from the title.
 *
 * When the residual text is not role-like, it is folded into `quals` and the
 * title is null (e.g. a bare degree name like "M.Tech-Construction Management").
 */
export function extractQualifications(job: string | null): {
  title: string | null;
  quals: string[];
} {
  const s = norm(job);
  if (!s) return { title: null, quals: [] };

  const quals: string[] = [];
  let rest = s.replace(QUAL_RE, (_match, qual: string) => {
    quals.push(norm(qual));
    return " ";
  });

  rest = rest
    .replace(/^[\s,;.\-]+/, "")
    .replace(/[\s,;.\-]+$/, "")
    .replace(/\s*[,;]\s*/g, " ")
    .trim();
  rest = norm(rest);

  if (!rest) {
    return { title: null, quals };
  }

  if (quals.length === 0 || ROLE_WORDS.test(rest)) {
    return { title: rest, quals };
  }

  quals.push(rest);
  return { title: null, quals };
}

/**
 * True when a job string is a spec, code, or product/industry description
 * rather than an actual role. Bare department words are NOT flagged.
 */
export function isNotARole(job: string | null): boolean {
  const s = norm(job);
  if (!s) return true;
  if (/^Code-\d+/i.test(s)) return true;
  if (/\b(turnkey|contractors?)\b/i.test(s)) return true;
  // Product/industry descriptions: leading quantity/unit or spec vocabulary.
  // A concrete role word wins: "Product Manager" is a role, not a product.
  if (!ROLE_WORDS.test(s)) {
    if (/^\d/.test(s)) return true;
    if (
      /\b(gw|mw|kw|module|modules|cell line|industrial|product|products|machine|machines)\b/i.test(
        s,
      )
    ) {
      return true;
    }
  }
  return false;
}
