/**
 * Pure company-name cleaning helpers for the DB cleanup scripts.
 *
 * No Prisma, no network, no filesystem, no LLM. Every function is
 * deterministic so the cleanup scripts can be re-run and unit-tested.
 *
 * Reuses `alnum` from ./text and the curated `CITY_TO_STATE` table from
 * @/lib/location rather than re-implementing either.
 */

import { CITY_TO_STATE } from "../location";
import { alnum, norm } from "./text";

/** Legal-form tokens dropped from a company's canonical key. */
const LEGAL_TOKENS = /\b(?:pvt|private|ltd|limited)\b/gi;

/** Company words that disqualify a value from being a person name. */
const COMPANY_WORDS =
  /\b(?:associates?|engineers?|enterprises?|solutions?|technologies|infra|infrastructure|limited|ltd|pvt|private|industries|corporation|corp|services?|traders?|trading|construction|builders?|group|company|consultants?|exports?|imports?|electricals?|electric|power|systems?|projects?|international)\b/i;

/** Strip dash runs and trailing separators from one candidate segment. */
function tidyCandidate(part: string): string {
  return norm(part.replace(/-{2,}/g, "-"))
    .replace(/[\s\-;]+$/g, "")
    .replace(/^[\s\-;]+/g, "");
}

/**
 * Clean a `;`-separated company string: strip dash runs per candidate, drop
 * case/punctuation-insensitive duplicates, and keep the first occurrence's
 * readable casing. Returns null for null/blank.
 */
export function cleanCompany(company: string | null): string | null {
  const raw = norm(company);
  if (!raw) return null;

  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of raw.split(";")) {
    const candidate = tidyCandidate(part);
    if (!candidate) continue;
    const key = alnum(canonicalCompanyKey(candidate));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(candidate);
  }

  return kept.length ? kept.join("; ") : null;
}

/**
 * The dedupe/conflict key for a company name.
 *
 * Lowercases, maps `&` between alphanumerics to `n` (so L&T == LnT == LNT),
 * drops a trailing " - Division" suffix, drops pvt/private/ltd/limited, removes
 * punctuation, and collapses whitespace. Returns "" for null/blank.
 */
export function canonicalCompanyKey(company: string | null): string {
  let s = norm(company).toLowerCase();
  if (!s) return "";

  s = s.replace(/([a-z0-9])&([a-z0-9])/g, "$1n$2");
  s = s.replace(/\s*-\s*[^-]*\bdivision$/i, "");
  s = s.replace(LEGAL_TOKENS, " ");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  return norm(s);
}

/** Conservative 2-4 token alphabetic person-name heuristic. */
export function looksLikePersonName(value: string | null): boolean {
  const s = norm(value);
  if (!s) return false;
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  return tokens.every((token) => /^[A-Za-z][A-Za-z.'-]*$/.test(token));
}

/**
 * True when a company value is really the contact's own person name.
 *
 * Requires a full-token containment relationship between the company and the
 * full name, and refuses any value carrying a company word (Associates,
 * Engineers, ...).
 */
export function companyIsPersonName(fullName: string, company: string): boolean {
  const name = norm(fullName).toLowerCase();
  const comp = norm(company).toLowerCase();
  if (!name || !comp) return false;
  if (COMPANY_WORDS.test(comp)) return false;

  if (comp === name) return true;

  const nameTokens = name.split(/\s+/);
  const compTokens = comp.split(/\s+/);
  return compTokens.every((token) => nameTokens.includes(token));
}

/** True when the value is exactly a known city name (bare city, no suffix). */
export function isBareCity(company: string): boolean {
  const key = norm(company).toLowerCase();
  if (!key) return false;
  return Object.prototype.hasOwnProperty.call(CITY_TO_STATE, key);
}
