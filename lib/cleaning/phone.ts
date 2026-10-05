/**
 * Pure phone-parsing helpers for the DB cleanup scripts.
 *
 * No Prisma, no network, no filesystem. Parsing is deterministic and never
 * coerces an invalid number into a valid-looking one: an unparseable value
 * yields `INVALID` with `e164: null`.
 *
 * The `/max` metadata build is imported (not the default root) because only
 * `/max` (and `/mobile`) carry number-type metadata, so `.getType()` returns
 * MOBILE / FIXED_LINE / FIXED_LINE_OR_MOBILE / TOLL_FREE rather than undefined.
 */

import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export type PhoneKind = "MOBILE" | "LANDLINE" | "TOLL_FREE" | "INVALID" | "UNKNOWN";

export interface ParsedPhone {
  raw: string;
  e164: string | null;
  kind: PhoneKind;
  ext?: string;
  note?: string;
}

type ParsedPhoneNumber = NonNullable<ReturnType<typeof parsePhoneNumberFromString>>;

/** Split a trailing extension off the number and return the base string. */
function extractExtension(raw: string): { base: string; ext?: string } {
  let base = raw.trim();
  let ext: string | undefined;

  const extMatch = base.match(/[\s,]*(?:ext|extn|extension)\.?\s*:?\s*(\d+)\s*$/i);
  if (extMatch) {
    ext = extMatch[1];
    base = base.slice(0, extMatch.index).trim();
  } else {
    const xMatch = base.match(/\s+x\.?\s*(\d+)\s*$/i);
    if (xMatch) {
      ext = xMatch[1];
      base = base.slice(0, xMatch.index).trim();
    }
  }

  base = base.replace(/\s*\(D\)\s*$/i, "").trim();

  return ext ? { base, ext } : { base };
}

/** Drop the trunk `0` that follows a `+91` country code: `+91 0321 ...` -> `+91321 ...`. */
function stripTrunkZero(s: string): string {
  return s.replace(/^(\+91)[\s-]*0(?=\d)/, "$1");
}

function kindFromType(parsed: ParsedPhoneNumber): PhoneKind {
  const type = parsed.getType();
  if (type === "MOBILE") return "MOBILE";
  if (type === "FIXED_LINE") return "LANDLINE";
  if (type === "TOLL_FREE") return "TOLL_FREE";
  if (type === "FIXED_LINE_OR_MOBILE") {
    // Only in this ambiguous branch: a 10-digit national number starting 6-9 is
    // a mobile. No hand-rolled shortcut anywhere else.
    return /^[6-9]\d{9}$/.test(parsed.nationalNumber) ? "MOBILE" : "LANDLINE";
  }
  return "UNKNOWN";
}

function toParsed(parsed: ParsedPhoneNumber, raw: string): ParsedPhone {
  return { raw, e164: parsed.number, kind: kindFromType(parsed) };
}

/** Parse one phone string. Invalid input yields `INVALID` with `e164: null`. */
export function parsePhone(raw: string, defaultRegion: "IN" = "IN"): ParsedPhone {
  const { base, ext } = extractExtension(raw);
  const cleaned = stripTrunkZero(base);
  const parsed = parsePhoneNumberFromString(cleaned, defaultRegion);

  if (!parsed || !parsed.isValid()) {
    return ext ? { raw, e164: null, kind: "INVALID", ext } : { raw, e164: null, kind: "INVALID" };
  }

  const result: ParsedPhone = { raw, e164: parsed.number, kind: kindFromType(parsed) };
  if (ext) {
    result.ext = ext;
  }
  return result;
}

/**
 * Split a concatenation of numbers that share one country code.
 *
 * Two shapes are handled:
 *  - an explicit `,`/`;` separator between numbers;
 *  - a solid digit run where every number after the first has the same national
 *    length as the first.
 *
 * Accept ONLY when every chunk validates and the chunks consume the full digit
 * string; otherwise return `null` so the raw value goes to review untouched.
 */
export function splitConcatenated(raw: string): ParsedPhone[] | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    const first = parsePhoneNumberFromString(parts[0], "IN");
    if (!first || !first.isValid()) {
      return null;
    }
    const country = first.country ?? "IN";
    const out: ParsedPhone[] = [toParsed(first, parts[0])];
    for (let i = 1; i < parts.length; i++) {
      const parsed = parsePhoneNumberFromString(parts[i], country);
      if (!parsed || !parsed.isValid()) {
        return null;
      }
      out.push(toParsed(parsed, parts[i]));
    }
    return out;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length <= 15) {
    return null;
  }

  const hasPlus = /^\+/.test(trimmed);
  const minLen = 4;

  for (let firstLen = minLen; firstLen <= digits.length - minLen; firstLen++) {
    const firstStr = hasPlus ? `+${digits.slice(0, firstLen)}` : digits.slice(0, firstLen);
    const first = parsePhoneNumberFromString(firstStr, "IN");
    if (!first || !first.isValid()) {
      continue;
    }

    const country = first.country ?? "IN";
    const nationalLen = first.nationalNumber.length;
    if (nationalLen < minLen) {
      continue;
    }

    const remainder = digits.slice(firstLen);
    if (remainder.length % nationalLen !== 0) {
      continue;
    }

    const out: ParsedPhone[] = [toParsed(first, firstStr)];
    let ok = true;
    for (let i = 0; i < remainder.length && ok; i += nationalLen) {
      const chunk = remainder.slice(i, i + nationalLen);
      const parsed = parsePhoneNumberFromString(chunk, country);
      if (!parsed || !parsed.isValid()) {
        ok = false;
        break;
      }
      out.push(toParsed(parsed, chunk));
    }

    if (ok) {
      return out;
    }
  }

  return null;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/**
 * Normalize a contact's mobile/tel sets.
 *
 * Valid MOBILE results land in `mobiles`; valid LANDLINE and TOLL_FREE results
 * land in `tels`; invalid entries stay in their original array and are added to
 * `review`. Each array is deduped on `e164` (first-seen order) and any number in
 * `mobiles` is removed from `tels`. Idempotent: feeding the output back in
 * returns identical sets.
 */
export function normalizeNumberSets(input: {
  mobiles: string[];
  tels: string[];
}): {
  mobiles: string[];
  tels: string[];
  review: { raw: string; reason: string }[];
} {
  const mobilesOut: string[] = [];
  const telsOut: string[] = [];
  const review: { raw: string; reason: string }[] = [];

  const parseEntry = (raw: string): ParsedPhone[] => {
    const direct = parsePhone(raw);
    if (direct.kind !== "INVALID") {
      return [direct];
    }
    if (raw.replace(/\D/g, "").length > 15) {
      const split = splitConcatenated(raw);
      if (split) {
        return split;
      }
    }
    return [direct];
  };

  const handle = (raw: string, source: "mobiles" | "tels"): void => {
    for (const parsed of parseEntry(raw)) {
      if (parsed.kind === "MOBILE" && parsed.e164) {
        mobilesOut.push(parsed.e164);
      } else if ((parsed.kind === "LANDLINE" || parsed.kind === "TOLL_FREE") && parsed.e164) {
        telsOut.push(parsed.e164);
      } else {
        if (source === "mobiles") {
          mobilesOut.push(raw);
        } else {
          telsOut.push(raw);
        }
        review.push({
          raw,
          reason: parsed.kind === "INVALID" ? "invalid or unparseable" : "unrecognized number type",
        });
      }
    }
  };

  for (const raw of input.mobiles) {
    handle(raw, "mobiles");
  }
  for (const raw of input.tels) {
    handle(raw, "tels");
  }

  const mobiles = dedupe(mobilesOut);
  const tels = dedupe(telsOut).filter((value) => !mobiles.includes(value));

  return { mobiles, tels, review };
}
