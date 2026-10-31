import { afterEach, describe, expect, it, vi } from "vitest";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { JWT } from "next-auth/jwt";

const jwtCallback = authOptions.callbacks!.jwt!;

const token = (role: JWT["role"]): JWT => ({
  id: "user_1",
  role,
  mustResetPassword: false,
  sub: "user_1",
});

const runJwt = (current: JWT) =>
  jwtCallback({
    token: current,
    user: undefined,
    account: null,
    trigger: undefined,
  } as never) as Promise<JWT>;

describe("session role refresh", () => {
  afterEach(() => {
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  });

  it("takes a promoted role from the database instead of the stale token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "DEVELOPER",
      mustResetPassword: false,
    } as never);

    const result = await runJwt(token("USER"));

    expect(result.role).toBe("DEVELOPER");
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user_1" },
      select: { role: true, mustResetPassword: true },
    });
  });

  it("takes a demoted role from the database", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "USER",
      mustResetPassword: false,
    } as never);

    const result = await runJwt(token("ADMIN"));

    expect(result.role).toBe("USER");
  });

  it("keeps the last known role when the database read fails", async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("offline"));

    const result = await runJwt(token("ADMIN"));

    expect(result.role).toBe("ADMIN");
  });

  it("keeps the last known role when the user row is gone", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const result = await runJwt(token("DEVELOPER"));

    expect(result.role).toBe("DEVELOPER");
  });
});
