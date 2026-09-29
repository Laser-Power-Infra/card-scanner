import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { requireApiRole, Role } from "@/lib/permissions";

import { clearSession, setSession } from "../helpers/session";

/**
 * Stands in for a future ADMIN-only route (Phase 2's reset-password endpoint is
 * the first real caller). Defined here rather than under app/api/ so Phase 1
 * ships no admin API surface: the capability and its proof land now, the
 * production consumer lands in Phase 2.
 */
async function adminOnlyHandler(roles: Role[] = [Role.ADMIN]) {
  const denied = await requireApiRole(roles);

  if (denied) return denied;

  return NextResponse.json({ success: true, data: "admin payload" });
}

/** A session whose only variable is the role. */
const sessionWithRole = (role: string) => ({
  expires: "2999-01-01T00:00:00.000Z",
  user: {
    id: "user_test",
    name: "Test User",
    email: "test@example.com",
    role,
  },
});

const UNAUTHORIZED_BODY = { success: false, error: "Unauthorized." };
const FORBIDDEN_BODY = { success: false, error: "Forbidden." };

afterEach(async () => {
  await clearSession();
  vi.clearAllMocks();
});

describe("SEC-04: a role-gated route tells 401 and 403 apart", () => {
  it("returns 401 with the Unauthorized envelope when there is no session", async () => {
    await clearSession();

    const response = await adminOnlyHandler();

    expect(response.status).toBe(401);
    // The 401 envelope, not the 403 one: an anonymous caller must not be told
    // that the route exists or what it protects.
    expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
  });

  it("returns 403 with the Forbidden envelope for a USER session on an ADMIN-only route", async () => {
    await setSession(sessionWithRole("USER"));

    const response = await adminOnlyHandler();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(FORBIDDEN_BODY);
  });

  it("returns 403 for a DEVELOPER session on an ADMIN-only route", async () => {
    // DEVELOPER is a distinct role in prisma/schema.prisma:40-44 and holds no
    // ADMIN rights in the reset model Phase 2 describes. This is the case that
    // catches a guard written as "reject unless ADMIN" that admits DEVELOPER.
    await setSession(sessionWithRole("DEVELOPER"));

    const response = await adminOnlyHandler();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(FORBIDDEN_BODY);
  });

  it("returns 200 and the handler payload for an ADMIN session on an ADMIN-only route", async () => {
    await setSession(sessionWithRole("ADMIN"));

    const response = await adminOnlyHandler();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: "admin payload" });
  });

  it("returns 401, not 403, when the required role list is empty", async () => {
    // Structural: the session check must precede the role check, so an empty
    // role list cannot become a way to change an anonymous caller's status code
    // from 401 to 403. Only a confirmed session can ever reach the role branch.
    await clearSession();

    const response = await adminOnlyHandler([]);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
  });

  it("returns 403 for a confirmed session holding no role at all", async () => {
    // A session that authenticated but whose role claim never made it into the
    // token is a permission failure, not an authentication failure: the caller
    // is known, so 403 is the honest answer.
    await setSession({ expires: "2999-01-01T00:00:00.000Z", user: { id: "u" } });

    const response = await adminOnlyHandler();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(FORBIDDEN_BODY);
  });

  it("decrypts the session exactly once on every path", async () => {
    // Structural, not behavioural. tests/helpers/session.ts backs
    // getServerSession with a mockResolvedValue, so a second read is free and
    // invisible here: the suite cannot see whether requireApiRole reads the
    // cookie once or three times, or whether a reorder of the auth-then-role
    // checks changed the number of reads. Pinning the count closes that gap --
    // this is the assertion that fails when someone reintroduces the second
    // getCurrentSession() call, or adds a third.
    const sessionReads = () => vi.mocked(getServerSession).mock.calls.length;

    await clearSession();
    vi.mocked(getServerSession).mockClear();
    expect((await adminOnlyHandler()).status).toBe(401);
    expect(sessionReads()).toBe(1);

    await setSession(sessionWithRole("USER"));
    vi.mocked(getServerSession).mockClear();
    expect((await adminOnlyHandler()).status).toBe(403);
    expect(sessionReads()).toBe(1);

    await setSession(sessionWithRole("ADMIN"));
    vi.mocked(getServerSession).mockClear();
    expect((await adminOnlyHandler()).status).toBe(200);
    expect(sessionReads()).toBe(1);
  });

  it("still derives 401 before 403 when the count is pinned", async () => {
    // The count assertion above would pass for a guard that read the session
    // once but evaluated the role first, so the ordering property is asserted
    // separately: an empty role list cannot turn an anonymous caller into a 403.
    await clearSession();
    vi.mocked(getServerSession).mockClear();

    const response = await adminOnlyHandler([]);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHORIZED_BODY);
    expect(vi.mocked(getServerSession).mock.calls.length).toBe(1);
  });
});
