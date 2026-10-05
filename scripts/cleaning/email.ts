/**
 * Pure email cleaning helpers for the DB cleanup scripts.
 *
 * No Prisma, no network, no filesystem, no LLM. Every function here is
 * deterministic so the cleanup scripts can be re-run and unit-tested.
 *
 * Reuses `norm` from ./text for whitespace handling.
 */

import { norm } from "./text";

/**
 * True for a `local@domain.tld` address with no whitespace, exactly one `@`,
 * non-empty local/domain, and a domain of dot-separated non-empty labels whose
 * TLD is at least 2 chars. Trailing/leading/double dots are rejected because
 * every label must be non-empty.
 */
export function validateEmail(e: string): boolean {
  const trimmed = norm(e);
  if (!trimmed) return false;
  if (/\s/.test(trimmed)) return false;

  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@")) return false;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!local || !domain) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (labels.some((label) => label.length === 0)) return false;

  const tld = labels[labels.length - 1];
  return tld.length >= 2;
}

function emailDomain(e: string): string {
  return e.slice(e.indexOf("@") + 1).toLowerCase();
}

/**
 * Repair an email with whitespace injected inside the local part or domain
 * (a common OCR artifact) by removing all whitespace and re-validating.
 *
 * Returns `null` when the input had no whitespace at all — nothing changed.
 * When the repaired string is still invalid, returns the repaired value with
 * `confident: false`. When valid, `confident` is TRUE only if the repaired
 * domain matches `hints.websiteHost` or one of `hints.rowDomains`
 * (case-insensitive); an unmatched-but-valid repair is `confident: false` so
 * the row is still flagged for review.
 */
export function repairEmailSpaces(
  e: string,
  hints: { websiteHost?: string; rowDomains?: string[] } = {},
): { value: string; confident: boolean } | null {
  if (!/\s/.test(e)) return null;

  const repaired = e.replace(/\s+/g, "");
  if (!validateEmail(repaired)) {
    return { value: repaired, confident: false };
  }

  const domain = emailDomain(repaired);
  const host = hints.websiteHost?.toLowerCase();
  if (host && domain === host) {
    return { value: repaired, confident: true };
  }

  const rowDomains = hints.rowDomains ?? [];
  if (rowDomains.some((rowDomain) => rowDomain.toLowerCase() === domain)) {
    return { value: repaired, confident: true };
  }

  return { value: repaired, confident: false };
}

/** Classic Levenshtein edit distance between two short strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

/**
 * Detect OCR variants of the same email within one row.
 *
 * A pair is suspect when it shares a local part but differs in domain, or
 * shares a domain with local parts within edit distance 2. A variant is
 * auto-dropped ONLY when the kept candidate's domain frequency is `>= 3` AND
 * the dropped candidate's frequency is exactly `1`. Any other pair (frequency
 * tie, unknown frequency, close local part on the same domain) keeps both and
 * sets `review: true`. Input order is preserved in `keep`; each email appears
 * at most once.
 */
export function resolveOcrVariants(
  emails: string[],
  domainFrequency: Map<string, number>,
): { keep: string[]; dropped: string[]; review: boolean } {
  const dropped = new Set<string>();
  let review = false;

  for (let i = 0; i < emails.length; i++) {
    for (let j = i + 1; j < emails.length; j++) {
      const a = emails[i];
      const b = emails[j];
      const atA = a.indexOf("@");
      const atB = b.indexOf("@");
      if (atA < 0 || atB < 0) continue;

      const localA = a.slice(0, atA);
      const localB = b.slice(0, atB);
      const domainA = a.slice(atA + 1).toLowerCase();
      const domainB = b.slice(atB + 1).toLowerCase();

      const sameLocalDiffDomain = localA === localB && domainA !== domainB;
      const sameDomainCloseLocal =
        domainA === domainB && localA !== localB && levenshtein(localA, localB) <= 2;
      if (!sameLocalDiffDomain && !sameDomainCloseLocal) continue;

      const freqA = domainFrequency.get(domainA);
      const freqB = domainFrequency.get(domainB);

      if (freqA !== undefined && freqB !== undefined) {
        if (freqA >= 3 && freqB === 1) {
          dropped.add(b);
          continue;
        }
        if (freqB >= 3 && freqA === 1) {
          dropped.add(a);
          continue;
        }
      }

      review = true;
    }
  }

  return {
    keep: emails.filter((email) => !dropped.has(email)),
    dropped: emails.filter((email) => dropped.has(email)),
    review,
  };
}
