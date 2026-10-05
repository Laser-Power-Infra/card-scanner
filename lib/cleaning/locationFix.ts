/**
 * Pure company-location repair for the DB cleanup scripts.
 *
 * No Prisma, no network, no filesystem, no LLM. Every function here is
 * deterministic so the cleanup scripts can be re-run and unit-tested.
 *
 * Reuses the curated `INDIAN_STATES` list from @/lib/location and
 * `norm`/`alnum` from ./text rather than re-implementing either.
 */

import { INDIAN_STATES } from "@/lib/location";
import { alnum, norm } from "@/lib/cleaning/text";

export interface LocationRepair {
  value: string | null;
  source: "pincode" | "text" | "existing" | "none";
  confidence: "high" | "low";
  /** Present when the pincode-derived state disagrees with the text-derived state. */
  conflict?: string;
  /** Present when there was content that could not be resolved to a state. */
  review?: string;
}

/**
 * PARTIAL SEED — pincode prefix -> state.
 *
 * This table is deliberately INCOMPLETE. It MUST be checked against current
 * India Post data before any production use. Only entries with high confidence
 * are included; anything uncertain is omitted so the row falls through to
 * `review` rather than being mislabelled.
 */
export const PIN_PREFIX_TO_STATE: Record<string, string> = {
  "11": "Delhi",
  "12": "Haryana",
  "20": "Uttar Pradesh",
  "38": "Gujarat",
  "40": "Maharashtra",
  "50": "Telangana",
  "56": "Karnataka",
  "60": "Tamil Nadu",
  "70": "West Bengal",
};

/** Minimum prefix length accepted by `canonicalState`. */
const MIN_PREFIX = 8;

/**
 * Canonicalize a state name (or prefix).
 *
 * Exact case-insensitive match against `INDIAN_STATES` first; otherwise accept
 * a UNIQUE case-insensitive prefix of at least 8 chars. Returns null when the
 * prefix is ambiguous (matches more than one state) or shorter than 8 chars.
 */
export function canonicalState(input: string): string | null {
  const n = norm(input).toLowerCase();
  if (!n) return null;

  const exact = INDIAN_STATES.find((state) => state.toLowerCase() === n);
  if (exact) return exact;

  if (n.length < MIN_PREFIX) return null;

  const matches = INDIAN_STATES.filter((state) =>
    state.toLowerCase().startsWith(n),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Split a raw `:::`-delimited value, dropping empties and alnum duplicates. */
function rawPieces(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(":::").map((part) => norm(part))) {
    if (!piece) continue;
    const key = alnum(piece);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(piece);
  }
  return out;
}

/** Keep only letter runs so pincodes/punctuation cannot confuse a state match. */
function lettersOnly(fragment: string): string {
  return norm(fragment.replace(/[^A-Za-z]+/g, " "));
}

/** Split free text into candidate fragments without breaking multi-word states. */
function candidateFragments(text: string): string[] {
  return text
    .split(/[,;/|()[\]{}:]|\s+-\s+|-|\s{2,}/)
    .map(lettersOnly)
    .filter(Boolean);
}

/** First canonical state found anywhere in a blob of text, or null. */
function scanForState(text: string): string | null {
  for (const fragment of candidateFragments(text)) {
    const state = canonicalState(fragment);
    if (state) return state;
  }
  return canonicalState(norm(text));
}

/** First canonical state found in the address, then across the raw pieces. */
function textState(address: string | null, pieces: string[]): string | null {
  if (address) {
    const fromAddress = scanForState(address);
    if (fromAddress) return fromAddress;
  }
  for (const piece of pieces) {
    const fromPiece = scanForState(piece);
    if (fromPiece) return fromPiece;
  }
  return null;
}

/** A raw fragment that is ALREADY an exact canonical state (no prefix fuzz). */
function existingCanonicalState(pieces: string[]): string | null {
  for (const piece of pieces) {
    const direct = INDIAN_STATES.find(
      (state) => state.toLowerCase() === norm(piece).toLowerCase(),
    );
    if (direct) return direct;
    for (const fragment of candidateFragments(piece)) {
      const exact = INDIAN_STATES.find(
        (state) => state.toLowerCase() === fragment.toLowerCase(),
      );
      if (exact) return exact;
    }
  }
  return null;
}

/** First 6-digit pincode found in the address, then across the raw pieces. */
function findPincode(address: string | null, pieces: string[]): string | null {
  const sources = address ? [address, ...pieces] : pieces;
  for (const source of sources) {
    const match = source.match(/\b\d{6}\b/);
    if (match) return match[0];
  }
  return null;
}

function stateFromPincode(pincode: string): string | null {
  return (
    PIN_PREFIX_TO_STATE[pincode.slice(0, 3)] ??
    PIN_PREFIX_TO_STATE[pincode.slice(0, 2)] ??
    null
  );
}

/**
 * Repair a company-location value.
 *
 * Precedence when choosing the value:
 *  1. Pincode derived from `address` or the raw fragments -> `source: "pincode"`.
 *     If an existing raw fragment already equals the pincode-derived state, the
 *     source is reported as `"existing"` instead (no overwrite).
 *  2. Text match via `canonicalState` over the address and raw fragments ->
 *     `source: "text"`.
 *  3. A raw fragment that is already a canonical state -> `source: "existing"`.
 *  4. Otherwise `source: "none"`; `review` is set only when there WAS content
 *     that could not be resolved. A genuinely empty input gets no `review`.
 *
 * When the pincode-derived state disagrees with the text-derived state, the
 * pincode wins and `conflict: "text said <State>"` is recorded.
 */
export function repairCompanyLocation(
  raw: string,
  address: string | null,
): LocationRepair {
  const pieces = rawPieces(raw);
  const pincode = findPincode(address, pieces);
  const pincodeState = pincode ? stateFromPincode(pincode) : null;

  if (pincodeState) {
    const existing = existingCanonicalState(pieces);
    if (existing && existing === pincodeState) {
      return { value: pincodeState, source: "existing", confidence: "high" };
    }

    const text = textState(address, pieces);
    const result: LocationRepair = {
      value: pincodeState,
      source: "pincode",
      confidence: "high",
    };
    if (text && text !== pincodeState) {
      result.conflict = `text said ${text}`;
    }
    return result;
  }

  const text = textState(address, pieces);
  if (text) {
    return { value: text, source: "text", confidence: "high" };
  }

  const existing = existingCanonicalState(pieces);
  if (existing) {
    return { value: existing, source: "existing", confidence: "high" };
  }

  const hadContent = pieces.length > 0 || !!norm(address);
  if (!hadContent) {
    return { value: null, source: "none", confidence: "low" };
  }

  return {
    value: null,
    source: "none",
    confidence: "low",
    review: "no pincode or state match",
  };
}
