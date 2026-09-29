import { afterEach, describe, expect, it, vi } from "vitest";
import { decode, encode } from "next-auth/jwt";
import type { JWT } from "next-auth/jwt";

import { clearSession, setSession } from "../helpers/session";

import { GET as contactsGET } from "@/app/api/contacts/route";

/**
 * SEC-05 is about what happens to a cookie before the guard ever sees it, so
 * this suite deliberately bypasses tests/setup.ts's next-auth mock and drives
 * next-auth's real JWE encode/decode. Every 401 below is the consequence of
 * real crypto, not of an assertion about a stub.
 *
 * Note on the pinned API: next-auth 4.24.15 takes a single params object, not
 * positional arguments, and `decode` has no `maxAge` option at all -- expiry is
 * enforced by `getServerSession` on top of `decode`, and the JWE check inside
 * `decode` runs with jose's `clockTolerance: 15`. See EXPIRATION_TOLERANCE.
 */
const SECRET = "test-secret-not-used-in-production";
const OTHER_SECRET = "a-completely-different-secret";

/** 30 days, the next-auth default session lifetime. */
const MAX_AGE = 60 * 60 * 24 * 30;

/**
 * jose's clockTolerance inside next-auth's decode() is 15 seconds, so a token
 * minted with maxAge: -1 is still accepted. The expired fixture has to clear
 * that tolerance by a wide margin or the case would pass for the wrong reason.
 */
const EXPIRATION_TOLERANCE = 60;

/** Shaped like the `jwt` callback in lib/auth.ts:74-81 actually produces. */
const VALID_CLAIMS = {
  id: "user_test",
  name: "Test User",
  email: "test@example.com",
  role: "ADMIN",
  sub: "user_test",
} satisfies JWT;

const mintValidCookie = () =>
  encode({ token: VALID_CLAIMS, secret: SECRET, maxAge: MAX_AGE });

/**
 * Deterministically corrupt the ciphertext of a compact JWE.
 *
 * The obvious construction -- appending to, or replacing, the last character of
 * the token -- is unsound. A256GCM's auth tag is 16 bytes, which is 22 base64url
 * characters, so only the top 4 bits of the final character carry data and the
 * remaining 2 are discarded by the decoder. Substituting "A" for a last
 * character in A-P (whose top 4 bits are all 0000) therefore leaves the tag
 * byte-for-byte identical and the token still decrypts: a tamper that silently
 * stops tampering roughly a quarter of the time.
 *
 * The ciphertext segment is ~150 fully significant characters, so a mid-segment
 * substitution always changes the recovered plaintext.
 */
function tamperCiphertext(token: string): string {
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
async function decodeSafely(token: string, secret: string): Promise<JWT | null> {
  try {
    return await decode({ token, secret });
  } catch {
    return null;
  }
}

/**
 * Feed the real crypto verdict into the session seam, then let a real guarded
 * handler respond. A refused cookie therefore reaches the handler as "no
 * session" because the decoder said so, not because a test hard-coded null.
 */
async function applyDecodedCookie(token: string, secret: string) {
  const decoded = await decodeSafely(token, secret);

  if (!decoded) {
    await clearSession();

    return null;
  }

  const exp = typeof decoded.exp === "number" ? decoded.exp : 0;

  await setSession({
    expires: new Date(exp * 1000).toISOString(),
    user: {
      id: decoded.id,
      name: decoded.name,
      email: decoded.email,
      role: decoded.role,
    },
  });

  return decoded;
}

const UNAUTHORIZED_BODY = { success: false, error: "Unauthorized." };

afterEach(async () => {
  await clearSession();
  vi.clearAllMocks();
});

describe("SEC-05: the session cookie is verified by real JWE crypto", () => {
  it("round-trips a correctly signed cookie and preserves the role", async () => {
    const encoded = await mintValidCookie();
    const decoded = await decode({ token: encoded, secret: SECRET });

    expect(decoded).not.toBeNull();
    expect(decoded?.role).toBe("ADMIN");
    expect(decoded?.id).toBe("user_test");
  });

  it("still serves a correctly signed cookie, so the fix locks nobody out", async () => {
    // The guard against a fix that rejects everything. A valid token decodes to
    // a session, the session reaches the handler, and the handler answers 200.
    const encoded = await mintValidCookie();

    expect(await applyDecodedCookie(encoded, SECRET)).not.toBeNull();

    const response = await contactsGET();

    expect(response.status).toBe(200);
  });

  it("returns no session for a tampered cookie", async () => {
    const encoded = await mintValidCookie();
    const tampered = tamperCiphertext(encoded);

    expect(tampered).not.toBe(encoded);
    expect(await decodeSafely(tampered, SECRET)).toBeNull();
  });

  it("401 when the cookie is tampered", async () => {
    const encoded = await mintValidCookie();
    const tampered = tamperCiphertext(encoded);

    // The decode assertion is checked first and independently, so this test
    // cannot pass merely because the session seam happened to be empty.
    expect(await decodeSafely(tampered, SECRET)).toBeNull();
    expect(await applyDecodedCookie(tampered, SECRET)).toBeNull();

    const response = await contactsGET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
  });

  it("returns no session for a cookie signed with a different secret", async () => {
    const foreign = await encode({ token: VALID_CLAIMS, secret: OTHER_SECRET });

    // A cookie the attacker minted themselves, as opposed to one they edited.
    // A self-consistent test that only tampers would never reach this case.
    expect(await decodeSafely(foreign, SECRET)).toBeNull();
  });

  it("401 when the cookie is signed with another secret", async () => {
    const foreign = await encode({ token: VALID_CLAIMS, secret: OTHER_SECRET });

    expect(await decodeSafely(foreign, SECRET)).toBeNull();
    expect(await applyDecodedCookie(foreign, SECRET)).toBeNull();

    const response = await contactsGET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
  });

  it("returns no session for an expired cookie", async () => {
    const expired = await encode({
      token: VALID_CLAIMS,
      secret: SECRET,
      maxAge: -EXPIRATION_TOLERANCE,
    });

    expect(await decodeSafely(expired, SECRET)).toBeNull();
  });

  it("401 when the cookie is expired", async () => {
    const expired = await encode({
      token: VALID_CLAIMS,
      secret: SECRET,
      maxAge: -EXPIRATION_TOLERANCE,
    });

    expect(await decodeSafely(expired, SECRET)).toBeNull();
    expect(await applyDecodedCookie(expired, SECRET)).toBeNull();

    const response = await contactsGET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
  });

  it("refuses a tampered cookie before any guard runs, so the 401 is not a mock artefact", async () => {
    // The negative control: the decoder alone is sufficient to empty the
    // session, and the guard is a consequence. The same code path then accepts
    // a genuine cookie, so the refusal cannot be a blanket rejection.
    const encoded = await mintValidCookie();
    const tampered = tamperCiphertext(encoded);

    expect(await decodeSafely(tampered, SECRET)).toBeNull();
    expect(await applyDecodedCookie(tampered, SECRET)).toBeNull();

    const refused = await contactsGET();

    expect(refused.status).toBe(401);

    expect(await applyDecodedCookie(encoded, SECRET)).not.toBeNull();

    const allowed = await contactsGET();

    expect(allowed.status).toBe(200);
  });
});
