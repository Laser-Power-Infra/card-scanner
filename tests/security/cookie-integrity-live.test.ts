import { describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";

import { VALID_CLAIMS, mintCookie, tamperCiphertext } from "../helpers/jwe";

// tests/setup.ts mocks `next-auth` for every test file so the auth-boundary
// suites have a "nobody is logged in" default. That mock is the seam this file
// exists to get behind, so it is removed here. Hoisted above the imports by
// Vitest, which is why the imported `getServerSession` is the real one.
vi.unmock("next-auth");

/**
 * HI-04: drive the REAL getServerSession, end to end, so that "real crypto
 * yields no session" is observed rather than simulated.
 *
 * cookie-integrity.test.ts is sound as far as it goes, but it decodes a real
 * JWE and then hands a hand-built session object to the tests/setup.ts
 * `getServerSession` mock. Every path in that file terminates at the seam, so
 * nothing in it can see a production regression in the *seam itself* -- above
 * all `lib/auth.ts:93` `secret: process.env.NEXTAUTH_SECRET` being unset, or
 * diverging from the secret the cookie was signed with.
 *
 * This file therefore unmocks next-auth (the "runs the real implementation, not
 * a mock" case below proves it took effect) and calls next-auth's own
 * getServerSession with the project's real `authOptions`, so the secret
 * derivation, the JWE decode and the session callbacks are all the real ones.
 *
 * ## Why the three-argument form
 *
 * lib/permissions.ts:34 calls `getServerSession(authOptions)` -- the one-
 * argument App Router form, which reads the request through `next/headers`.
 * Outside a Next request scope that throws:
 *
 *     `headers` was called outside a request scope.
 *     Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context
 *
 * (observed, not assumed). `next-auth` is externalized by Vitest, so its
 * `require("next/headers")` bypasses the module graph and `vi.mock("next/headers")`
 * cannot intercept it; the only way to satisfy that form is to hand-seed
 * Next's private `workAsyncStorage` / `workUnitAsyncStorage` singletons. That is
 * deliberately NOT done here: it would couple the suite to undocumented
 * `next/dist/server/app-render/*` paths, and a green test built on a fake
 * request scope is worth less than a real one.
 *
 * Both forms converge immediately after that branch, on the same call:
 *
 *     AuthHandler({ options, req: { action: "session", method: "GET",
 *                                   cookies: req.cookies, headers: req.headers } })
 *
 * with the same `options.secret ??= process.env.NEXTAUTH_SECRET`. The property
 * under test -- a real JWE cookie decoded against the real configured secret,
 * through the real `jwt.decode` and the real `callbacks.session` -- is
 * identical. The only thing the three-argument form does not exercise is the
 * request-scope plumbing, which is not a security property. What is NOT
 * covered here is calling a guarded *route handler* with a live cookie, since
 * that handler goes through lib/permissions.ts and therefore the one-argument
 * form; the handler-level hop stays in cookie-integrity.test.ts, behind the
 * mock, where it already is.
 *
 * Expect `jwt_session_error` lines on stderr from the refusal cases. That is
 * next-auth's own logger reporting the real JWEDecryptionFailed / JWTExpired it
 * caught in core/routes/session.js -- the production behaviour this file is here
 * to observe, not a broken fixture.
 */

/** Detached from any real request, and everything next-auth reads off it. */
const noopResponse = {
  getHeader: () => undefined,
  setCookie: () => undefined,
  setHeader: () => undefined,
};

/**
 * A request carrying at most one session cookie. The host matters: next-auth
 * derives the base URL from it, and a non-https host is what selects the
 * `next-auth.session-token` (not `__Secure-...`) cookie name.
 */
function requestWith(cookie?: string) {
  return {
    headers: { host: "localhost:4000" },
    cookies: cookie ? { "next-auth.session-token": cookie } : {},
  };
}

/** The real getServerSession, on the project's real authOptions. */
function liveSession(cookie?: string, options = authOptions) {
  return getServerSession(
    requestWith(cookie) as never,
    noopResponse as never,
    options
  );
}

const OTHER_SECRET = "a-completely-different-secret";

/**
 * The secret the deployment signs cookies with: the environment variable, not
 * `authOptions.secret`.
 *
 * This is the point of the file. In production next-auth mints through its own
 * createSecret(), which resolves to `authOptions.secret` -- which is *supposed*
 * to be NEXTAUTH_SECRET. A fixture that minted with `authOptions.secret` and
 * then expected getServerSession to accept it would be self-referential: it
 * would keep passing after the two had drifted apart, which is precisely the
 * regression under test. Minting from the environment makes agreement between
 * the signing secret and the reading secret the thing being asserted.
 */
const ENV_SECRET = process.env.NEXTAUTH_SECRET as string;

/**
 * jose's clockTolerance inside next-auth's decode() is 15 seconds, so a token
 * minted with maxAge: -1 is still accepted. The expired fixture has to clear
 * that tolerance by a wide margin or the case would pass for the wrong reason.
 */
const EXPIRATION_TOLERANCE = 60;

describe("HI-04: the real getServerSession refuses what the real crypto rejects", () => {
  it("runs next-auth's implementation rather than the tests/setup.ts mock", () => {
    // If vi.unmock ever stopped taking effect, every other case in this file
    // would still pass -- the mock returns null for a tampered cookie, which is
    // exactly what a refusal looks like. This is the assertion that stops that
    // from being a silent pass.
    expect(vi.isMockFunction(getServerSession)).toBe(false);
    expect(getServerSession.toString()).toContain("isRSC");
  });

  it("resolves a cookie signed with the configured secret into a session", async () => {
    // The positive half. next-auth derives its decoding secret from
    // `authOptions.secret` via core/lib/utils.js createSecret(), so this
    // succeeds only if lib/auth.ts:93 handed it the real configured secret.
    const cookie = await mintCookie(VALID_CLAIMS, ENV_SECRET);

    const session = await liveSession(cookie);

    expect(session).not.toBeNull();
    expect(session?.user.id).toBe("user_test");
    // `role` is not part of the default session shape; it only arrives because
    // the real `callbacks.session` in lib/auth.ts:83-90 ran.
    expect(session?.user.role).toBe("ADMIN");
  });

  it("returns no session for a tampered cookie", async () => {
    const tampered = tamperCiphertext(
      await mintCookie(VALID_CLAIMS, ENV_SECRET)
    );

    expect(tampered).not.toBe(
      await mintCookie(VALID_CLAIMS, ENV_SECRET)
    );
    expect(await liveSession(tampered)).toBeNull();
  });

  it("returns no session for a cookie signed with another secret", async () => {
    // A cookie the attacker minted themselves, as opposed to one they edited.
    const foreign = await mintCookie(VALID_CLAIMS, OTHER_SECRET);

    expect(await liveSession(foreign)).toBeNull();
  });

  it("returns no session for an expired cookie", async () => {
    const expired = await mintCookie(
      VALID_CLAIMS,
      ENV_SECRET,
      -EXPIRATION_TOLERANCE
    );

    expect(await liveSession(expired)).toBeNull();
  });

  it("returns no session when the request carries no cookie", async () => {
    expect(await liveSession()).toBeNull();
  });

  it("accepts the genuine cookie and refuses the tampered one in the same run", async () => {
    // The negative control, and the reason the other cases are trustworthy: a
    // blanket rejection -- a guard or a secret that refuses everything -- fails
    // here, because the valid cookie still has to come back.
    const cookie = await mintCookie(VALID_CLAIMS, ENV_SECRET);

    expect(await liveSession(cookie)).not.toBeNull();
    expect(await liveSession(tamperCiphertext(cookie))).toBeNull();
  });

  it("binds authOptions.secret to NEXTAUTH_SECRET", () => {
    // The specific production regression the mocked suite structurally cannot
    // see. lib/auth.ts:93 reads the environment at module scope; if it were
    // removed, hardcoded, or pointed somewhere else, the failure would be
    // "everyone is logged out" in production and nothing anywhere in the suite
    // would go red.
    expect(authOptions.secret).toBeDefined();
    expect(authOptions.secret).toBe(process.env.NEXTAUTH_SECRET);
  });

  it("yields no session once the configured secret diverges from the cookie's", async () => {
    // The other half of the same regression, behavioural rather than textual:
    // a cookie is only accepted while getServerSession is handed the secret it
    // was signed with, which is precisely the property that breaks when
    // NEXTAUTH_SECRET is unset on one side of the deployment.
    const cookie = await mintCookie(VALID_CLAIMS, ENV_SECRET);

    expect(await liveSession(cookie, { ...authOptions, secret: OTHER_SECRET }))
      .toBeNull();
  });
});
