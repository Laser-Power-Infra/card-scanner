import { getServerSession } from "next-auth";
import { vi } from "vitest";

/**
 * A minimal but structurally valid next-auth v4 JWT session. The auth-boundary
 * tests only care that `session.user` is truthy, but a complete object keeps the
 * helper usable by the Phase 2 role tests without a rewrite.
 */
export const TEST_SESSION = {
  expires: "2999-01-01T00:00:00.000Z",
  user: {
    id: "user_test",
    name: "Test User",
    email: "test@example.com",
    role: "USER",
  },
};

/**
 * Make the next-auth seam resolve to `session` for the rest of the test.
 * tests/setup.ts already declared the `vi.mock("next-auth", ...)` for every test
 * file, so `getServerSession` is a mock here without any per-file declaration.
 */
export async function setSession(session: unknown = TEST_SESSION) {
  vi.mocked(getServerSession).mockResolvedValue(session as never);
}

/**
 * Return the seam to its "nobody is logged in" default. Every test starts from
 * this state, so the unauthenticated cases are the real starting condition and
 * not an artefact of a previous test leaking a session.
 */
export async function clearSession() {
  vi.mocked(getServerSession).mockResolvedValue(null);
}
