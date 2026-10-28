import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/contacts/route";

const get = (qs: string) =>
  GET(new NextRequest(new URL(`/api/contacts?${qs}`, "http://localhost")));

const calls = () =>
  vi.mocked(prisma.$queryRaw).mock.calls.map((c) => c[0] as unknown as { sql: string; values: unknown[] });

beforeEach(() => vi.mocked(prisma.$queryRaw).mockClear());

describe("GET /api/contacts", () => {
  it("clamps page and pageSize", async () => {
    const body = await (await get("page=-3&pageSize=9999")).json();

    expect(body).toMatchObject({ page: 1, pageSize: 200 });
    expect((await (await get("pageSize=0")).json()).pageSize).toBe(25);
  });

  it("always restricts to active contacts", async () => {
    await get("");

    expect(calls().length).toBe(7);
    for (const c of calls()) expect(c.sql).toContain(`"status" = 'active'`);
  });

  it("passes q as an escaped parameter, never as SQL text", async () => {
    await get("q=50%25");

    for (const c of calls()) {
      expect(c.sql).not.toContain("50");
      expect(c.values).toContain("%50\\%%");
    }
  });
});
