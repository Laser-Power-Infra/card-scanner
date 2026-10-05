/**
 * Pure text-cleaning helpers for the DB cleanup scripts.
 *
 * No Prisma, no network, no filesystem, no LLM. Every function here is
 * deterministic so the cleanup scripts can be re-run and unit-tested.
 */

/** Collapse runs of whitespace to a single space and trim. Nullish -> "". */
export function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Lowercase and keep only `[a-z0-9]`. Nullish -> "". */
export function alnum(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Deterministically undo a UTF-8 -> Latin-1 mojibake round trip.
 *
 * Accept the repair ONLY if it introduces no U+FFFD replacement character AND
 * the count of mojibake-marker characters (Â Ã æ ð) actually drops. There is
 * no LLM fallback: either the round trip is a clean repair, or it is rejected
 * and the original string is returned untouched.
 */
export function repairMojibake(s: string): { value: string; repaired: boolean } {
  const repaired = Buffer.from(s, "latin1").toString("utf8");
  const replacementCount = (repaired.match(/\uFFFD/g) ?? []).length;
  if (replacementCount > 0) {
    return { value: s, repaired: false };
  }

  const markerCount = (str: string): number =>
    (str.match(/[ÂÃæð]/g) ?? []).length;

  if (markerCount(repaired) < markerCount(s)) {
    return { value: repaired, repaired: true };
  }

  return { value: s, repaired: false };
}

/** Leading import tags seen in card data: DOM(s), EXP, CHINA, DEPTT, LASER, GMD, SOM, NEW, T. */
export const SOURCE_TAGS = /^(DOMS?|EXP|CHINA|DEPTT|LASER|GMD|SOM|NEW|T)(?=\s)/i;

/** A plausible 2-4 word person name: alphabetic tokens with initials/dots/hyphens. */
function isPlausiblePersonName(s: string): boolean {
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) {
    return false;
  }
  return tokens.every((token) => /^[A-Za-z][A-Za-z.'-]*$/.test(token));
}

/**
 * Detect and strip a leading source tag from a name.
 *
 * - `T` (bare `T` + space + capitalised token) is detected but NEVER stripped:
 *   the caller routes it to the LLM. `T.` is an initial, not a tag.
 * - Other tags are stripped only when the remainder is a plausible 2-4 word
 *   person name; otherwise the tag is returned alongside the original value so
 *   the caller can flag it for the LLM.
 * - A dash-only input is a placeholder: returned unchanged with no tag, never
 *   routed to the LLM.
 */
export function stripSourceTag(name: string): { value: string; tag: string | null } {
  const trimmed = norm(name);
  if (!trimmed || /^[-\s]+$/.test(trimmed)) {
    return { value: trimmed, tag: null };
  }

  const match = trimmed.match(SOURCE_TAGS);
  if (!match) {
    return { value: trimmed, tag: null };
  }

  const tag = match[1].toUpperCase();
  const remainder = trimmed.slice(match[0].length).trim();

  if (tag === "T") {
    if (!/^[A-Z]/.test(remainder)) {
      return { value: trimmed, tag: null };
    }
    return { value: trimmed, tag };
  }

  if (remainder && isPlausiblePersonName(remainder)) {
    return { value: remainder, tag };
  }

  return { value: trimmed, tag };
}

/**
 * Strip common honorific prefixes (mr/mrs/ms/er) and suffixes
 * (sir/ji/saab/sahab/saheb/madam/maam/mam), case-insensitively, with an
 * optional trailing dot.
 *
 * `sri|shri|shree` are deliberately NOT stripped (they prefix company names),
 * and `dr` / `prof` are kept as written.
 */
export function stripHonorifics(name: string): string {
  let out = norm(name);
  out = out.replace(/^(mrs|mr|ms|er)\.?\s+/i, "");
  out = out.replace(/\s+(sir|ji|saab|sahab|saheb|madam|maam|mam)\.?$/i, "");
  return norm(out);
}
