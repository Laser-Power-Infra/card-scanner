import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

describe("test harness", () => {
  it("resolves the @ alias to the repository root", async () => {
    const mod = await import("@/lib/queue/config");
    expect(mod.QUEUES.PROFILE_COLLECTION).toBe("CS-profile:collection");
  });

  it("replaces the prisma singleton with an offline fake", () => {
    expect(vi.isMockFunction(prisma.contact.findMany)).toBe(true);
  });

  it("removes the credentials that would allow a live call", () => {
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.RABBITMQ_URL).toBeUndefined();
  });
});
