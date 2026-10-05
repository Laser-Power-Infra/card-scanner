/**
 * Pure website / LinkedIn URL normalization for the DB cleanup scripts.
 *
 * No Prisma, no network, no filesystem, no LLM. Deterministic: the same input
 * always produces the same output so the cleanup can be re-run and tested.
 */

/**
 * Normalize a website value.
 *
 * - All whitespace is stripped first.
 * - A scheme-less value is treated as `https://<value>` (how the app stores
 *   bare domains).
 * - Only the HOST is lowercased; the path, query and hash are preserved
 *   byte-for-byte.
 * - On parse failure (or a host with no dot) the space-stripped input is
 *   returned unchanged with `valid: false` and `changed: false`.
 * - `changed` is true when the normalized value differs from the
 *   space-stripped input.
 */
export function normalizeWebsite(w: string): {
  value: string;
  changed: boolean;
  valid: boolean;
} {
  const stripped = w.replace(/\s+/g, "");
  if (!stripped) {
    return { value: stripped, changed: false, valid: false };
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(stripped);
  const candidate = hasScheme ? stripped : `https://${stripped}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { value: stripped, changed: false, valid: false };
  }

  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return { value: stripped, changed: false, valid: false };
  }

  const scheme = hasScheme ? parsed.protocol : "https:";
  const auth = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
    : "";
  const host = (auth + parsed.hostname).toLowerCase();
  const port = parsed.port ? `:${parsed.port}` : "";
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  const value = `${scheme}//${host}${port}${path}${parsed.search}${parsed.hash}`;

  return { value, changed: value !== stripped, valid: true };
}

/**
 * Normalize a LinkedIn profile URL.
 *
 * - `https://linkedin.com/<slug>` is rewritten to
 *   `https://linkedin.com/in/<slug>` when `<slug>` is `[a-z0-9-]{3,100}`.
 * - An already-correct `/in/<slug>` URL (including `www.` variants) is
 *   returned unchanged.
 * - A bare handle with no scheme/host, a non-linkedin host, or any other path
 *   shape yields `{ value: null, confident: false }`.
 */
export function normalizeLinkedin(v: string): {
  value: string | null;
  confident: boolean;
} {
  const trimmed = v.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { value: null, confident: false };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { value: null, confident: false };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com") {
    return { value: null, confident: false };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (
    segments.length === 2 &&
    segments[0] === "in" &&
    /^[a-z0-9-]{3,100}$/i.test(segments[1])
  ) {
    return { value: trimmed, confident: true };
  }

  if (segments.length === 1 && /^[a-z0-9-]{3,100}$/i.test(segments[0])) {
    return { value: `https://linkedin.com/in/${segments[0]}`, confident: true };
  }

  return { value: null, confident: false };
}
