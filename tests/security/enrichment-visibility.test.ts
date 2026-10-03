import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

import { clearSession, setSession } from "../helpers/session";

import { GET as contactsGET } from "@/app/api/contacts/route";
import { GET as profileGET } from "@/app/api/profile/[id]/route";

/**
 * SEC-08: an anonymous caller gets the contact rows and the enrichment STATUS,
 * and never the researched content.
 *
 * This is the contract the whole public-directory change rests on, so it is
 * asserted on the Prisma call rather than on the response body.
 *
 * The reason is tests/setup.ts: `contact.findMany` and `contact.findUnique` are
 * `vi.fn(async () => [])` -- they ignore their arguments and return a constant.
 * A test that asserted on the response body would therefore pass no matter which
 * `include` the route asked for, and would prove nothing at all while looking
 * like it proved everything. The query the handler builds is the thing that can
 * actually regress, so that is what is asserted.
 *
 * The narrowing has to happen in the query for a second reason: selecting the
 * full row and then deleting the fields on the way out would still pull every
 * researched column across the wire and into the server's memory, and any
 * future logging or error path in between would leak it.
 */

/** The researched columns. If one of these appears in an `include`, we leaked. */
const ENRICHMENT_ONLY_FIELDS = [
  "summary",
  "career_background",
  "company_details",
  "company_core_business",
  "sources",
  "location",
  "other_profiles",
  "linkedin_url",
  "linkedin_photo_url",
  "avatar_url",
  "facebook_url",
  "twitter_url",
  "instagram_url",
  "official_site",
  "attempts",
  "completed",
  "failed",
  "expected",
  "created_at",
  "updated_at",
  "enriched_at",
] as const;

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

const req = (path: string, init?: NextRequestInit) =>
  new NextRequest(new URL(path, "http://localhost"), init);

const profileArgs = (id: string) =>
  profileGET(req(`/api/profile/${id}`), {
    params: Promise.resolve({ id }),
  } as never);

/** The single argument the route passed to Prisma, as a plain object. */
const lastArgs = (fn: unknown): Record<string, unknown> => {
  const mock = fn as { mock: { calls: unknown[][] } };

  return mock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
};

afterEach(async () => {
  await clearSession();
  vi.clearAllMocks();
});

describe("SEC-08: an anonymous read is narrowed to the enrichment status", () => {
  it("asks Prisma for status only when there is no session", async () => {
    await contactsGET();

    expect(lastArgs(prisma.contact.findMany)).toMatchObject({
      select: { enrichment: { select: { status: true } } },
    });
  });

  it("asks Prisma for the full enrichment row when there is a session", async () => {
    await setSession();
    await contactsGET();

    expect(lastArgs(prisma.contact.findMany)).toMatchObject({
      select: { enrichment: { select: { status: true } } },
    });
  });

  it("narrows the single-contact read the same way", async () => {
    await profileArgs("abc");

    expect(lastArgs(prisma.contact.findUnique)).toMatchObject({
      include: { enrichment: { select: { status: true } } },
    });
  });

  it("widens the single-contact read once a session exists", async () => {
    await setSession();
    await profileArgs("abc");

    expect(lastArgs(prisma.contact.findUnique)).toMatchObject({
      include: { enrichment: true },
    });
  });

  /**
   * The belt to the braces above: whatever the route did, no researched field
   * name may appear anywhere in the Prisma call it made. This catches a future
   * edit that reaches the right shape the wrong way -- for instance
   * `select: { status: true, summary: true }`, which toMatchObject on the
   * exact object would happily accept.
   */
  it.each([
    ["findMany", () => contactsGET(), () => prisma.contact.findMany],
    [
      "findUnique",
      () => profileArgs("abc"),
      () => prisma.contact.findUnique,
    ],
  ])(
    "%s names no researched enrichment column for an anonymous caller",
    async (_label, invoke, readFn) => {
      await invoke();

      const serialised = JSON.stringify(lastArgs(readFn()));

      for (const field of ENRICHMENT_ONLY_FIELDS) {
        expect(serialised, `${_label} asked Prisma for the "${field}" column`).not.toContain(
          field
        );
      }
    }
  );

  it("still returns the contact fields an anonymous caller needs", async () => {
    await contactsGET();

    // The whole directory depends on this being a list-shaped response:
    // app/page.tsx assigns it straight into state and throws if it is not an
    // array. Guarding that here means a future "let me normalise this to
    // { success, data }" lands as a red test rather than a blank page.
    const response = await contactsGET();

    expect(Array.isArray((await response.json()).contacts)).toBe(true);
  });
});
