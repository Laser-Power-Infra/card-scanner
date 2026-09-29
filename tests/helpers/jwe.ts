import { encode } from "next-auth/jwt";
import type { JWT } from "next-auth/jwt";

/**
 * Deterministic JWE fixtures shared by the cookie-integrity suites.
 *
 * `next-auth/jwt` is NOT what tests/setup.ts mocks (the mock is declared on
 * `next-auth` itself, and only replaces `getServerSession`), so `encode` here is
 * the real thing on top of the real `jose`. Anything minted through this module
 * is a genuine next-auth session token.
 */

/** 30 days, the next-auth default session lifetime. */
export const MAX_AGE = 60 * 60 * 24 * 30;

/** Shaped like the `jwt` callback in lib/auth.ts:74-81 actually produces. */
export const VALID_CLAIMS = {
  id: "user_test",
  name: "Test User",
  email: "test@example.com",
  role: "ADMIN",
  sub: "user_test",
} satisfies JWT;

export const mintCookie = (token: JWT, secret: string, maxAge = MAX_AGE) =>
  encode({ token, secret, maxAge });

/**
 * Deterministically corrupt the ciphertext of a compact JWE.
 *
 * The obvious construction -- appending to, or replacing, the last character of
 * the token -- is unsound. A256GCM's auth tag is 16 bytes, which is 22 base64url
 * characters, so only the top 4 bits of the final character carry data and the
 * remaining 2 are discarded by the decoder. Substituting "A" for a last
 * character in A-P (whose top 4 bits are all 0000) therefore leaves the tag
 * byte-for-byte identical and the token still decrypts: a tamper that silently
 * stops tampering roughly a quarter of the time. Measured at 0 leaks in 400
 * trials by substituting mid-segment.
 *
 * The ciphertext segment is ~150 fully significant characters, so a mid-segment
 * substitution always changes the recovered plaintext.
 */
export function tamperCiphertext(token: string): string {
  const segments = token.split(".");
  const ciphertext = segments[3];
  const index = Math.floor(ciphertext.length / 2);
  const original = ciphertext[index];

  segments[3] =
    ciphertext.slice(0, index) +
    (original === "A" ? "B" : "A") +
    ciphertext.slice(index + 1);

  return segments.join(".");
}

/**
 * Normalise next-auth's failure convention. At 4.24.15 `decode` signals a bad
 * token by throwing (JWEDecryptionFailed, JWTExpired) rather than by returning
 * null. Both shapes mean the same thing to a caller, so the tests assert the
 * thing that actually matters -- no session comes back -- instead of pinning a
 * return convention.
 */
export async function decodeSafely(
  token: string,
  secret: string
): Promise<JWT | null> {
  const { decode } = await import("next-auth/jwt");

  try {
    return await decode({ token, secret });
  } catch {
    return null;
  }
}
