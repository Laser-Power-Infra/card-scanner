import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/contacts/[id]/profile/route";
import { prisma } from "@/lib/prisma";
import type { ContactProfileResult } from "@/types/card";

import { clearSession, setSession } from "../helpers/session";

/**
 * SEC-08 for the drawer's read path. The grid streams raw contact rows; the
 * drawer is the first client caller that loads a single contact, so its Prisma
 * query must narrow `enrichment` for anonymous callers exactly like
 * app/contacts/[id]/page.tsx and GET /api/contacts do.
 */

const CONTACT = {
  id: "c1",
  fullName: "A. Person",
  jobTitle: "Engineer",
  company: "ACME",
  mobileNumbers: ["+91 90000 00000"],
  telephoneNumbers: [],
  emails: ["a@example.com"],
  website: "acme.example",
  address: "1 Road",
  companyLocation: "Kolkata",
  linkedin: "linkedin.com/in/a-person",
  rawNotes: null,
  originalImageUrl: "https://storage.test/card.png",
  subsidiaryMatches: ["ACME INFRA"],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  subsidiaryMatchedAt: null,
};

const FULL_ENRICHMENT = {
  contact_id: "c1",
  status: "DONE",
  attempts: 1,
  completed: 1,
  failed: 0,
  expected: 1,
  linkedin_url: "linkedin.com/in/a-person",
  linkedin_photo_url: null,
  avatar_url: "https://storage.test/avatar.jpg",
  facebook_url: null,
  twitter_url: null,
  instagram_url: null,
  other_profiles: "WhatsApp: https://wa.me/919000000000",
  company_details: "Makes cables.",
  company_core_business: "Cables",
  official_site: "https://acme.example",
  sources: "https://example.com/source",
  location: "Kolkata, India",
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  country: null,
  address_verified_at: null,
  address_attempts: 0,
  career_background: "20 years in cables.",
  summary: "A summary.",
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
  enriched_at: new Date("2026-01-01T00:00:00Z"),
};

const call = (id: string) =>
  GET(new NextRequest(`http://localhost/api/contacts/${id}/profile`), {
    params: Promise.resolve({ id }),
  } as never);

const lastArgs = (fn: unknown): Record<string, unknown> => {
  const mock = fn as { mock: { calls: unknown[][] } };

  return mock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
};

const mockContact = (enrichment: unknown) =>
  vi.mocked(prisma.contact.findUnique).mockResolvedValueOnce({
    ...CONTACT,
    enrichment,
  } as never);

afterEach(async () => {
  await clearSession();
  vi.clearAllMocks();
});

describe("GET /api/contacts/[id]/profile", () => {
  it("narrows the enrichment read for an anonymous caller", async () => {
    mockContact({ status: "DONE" });

    const response = await call("c1");
    const result = (await response.json()) as ContactProfileResult;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(lastArgs(prisma.contact.findUnique)).toMatchObject({
      where: { id: "c1" },
      include: { enrichment: { select: { status: true } } },
    });

    const serialised = JSON.stringify(lastArgs(prisma.contact.findUnique));
    expect(serialised).not.toContain("summary");
    expect(serialised).not.toContain("avatar_url");
    expect(serialised).not.toContain("career_background");

    expect(result.canSeeEnrichment).toBe(false);
    expect(result.enrichment?.status).toBe("DONE");
    expect(result.enrichment?.summary).toBeNull();
    expect(result.enrichment?.avatarUrl).toBeNull();
  });

  it("loads the full enrichment for a signed-in caller and maps it", async () => {
    await setSession();
    mockContact(FULL_ENRICHMENT);

    const response = await call("c1");
    const result = (await response.json()) as ContactProfileResult;

    expect(lastArgs(prisma.contact.findUnique)).toMatchObject({
      include: { enrichment: true },
    });

    expect(result.canSeeEnrichment).toBe(true);
    expect(result.contact.fullName).toBe("A. Person");
    expect(result.contact.subsidiaryMatches).toEqual(["ACME INFRA"]);
    expect(result.enrichment?.summary).toBe("A summary.");
    expect(result.enrichment?.avatarUrl).toBe("https://storage.test/avatar.jpg");
    expect(result.enrichment?.otherProfiles).toContain("wa.me");
  });

  describe("locations", () => {
    const PUBLIC_ROW = {
      id: "l1",
      address_line1: "12 Mill Rd",
      address_line2: "Floor 3",
      city: "Pune",
      state: "Maharashtra",
      postal_code: "411001",
      country: "India",
      latitude: 18.52,
      longitude: 73.85,
      is_primary: true,
      status: "VERIFIED",
      precision: "STREET",
    };
    const SOURCE_FIELDS = ["source_url", "source_urls", "source_type"] as const;

    const mockWithLocations = (enrichment: unknown, companyLocations: unknown[]) =>
      vi.mocked(prisma.contact.findUnique).mockResolvedValueOnce({
        ...CONTACT,
        enrichment,
        companyLocations,
      } as never);

    it("never asks Postgres for provenance columns on an anonymous read", async () => {
      mockWithLocations({ status: "DONE" }, [PUBLIC_ROW]);

      const result = (await (await call("c1")).json()) as ContactProfileResult;

      const args = lastArgs(prisma.contact.findUnique) as {
        include: { companyLocations: { select: Record<string, boolean>; orderBy: unknown } };
      };
      expect(args.include.companyLocations.select).toMatchObject({
        address_line1: true,
        address_line2: true,
        postal_code: true,
        latitude: true,
        is_primary: true,
        status: true,
        precision: true,
      });
      const serialised = JSON.stringify(args);
      for (const field of SOURCE_FIELDS) expect(serialised).not.toContain(field);
      expect(serialised).not.toContain("address_verified_at");

      expect(result.locations).toEqual([PUBLIC_ROW]);
      expect(result.enrichment?.addressVerifiedAt).toBeNull();
    });

    it("loads provenance and the verified time for a signed-in caller", async () => {
      await setSession();
      const withSources = {
        ...PUBLIC_ROW,
        source_url: "https://acme.example/contact",
        source_urls: ["https://acme.example/contact", "https://dir.example/acme"],
        source_type: "OWN_SITE",
      };
      mockWithLocations(
        { ...FULL_ENRICHMENT, address_verified_at: new Date("2026-03-12T10:00:00Z") },
        [withSources]
      );

      const result = (await (await call("c1")).json()) as ContactProfileResult;

      const args = lastArgs(prisma.contact.findUnique) as {
        include: { companyLocations: { select: Record<string, boolean> } };
      };
      for (const field of SOURCE_FIELDS) expect(args.include.companyLocations.select[field]).toBe(true);

      expect(result.locations[0]).toMatchObject({ source_type: "OWN_SITE", source_url: "https://acme.example/contact" });
      expect(result.enrichment?.addressVerifiedAt).toBe("2026-03-12T10:00:00.000Z");
    });

    it("orders the primary location first", async () => {
      mockWithLocations({ status: "DONE" }, []);

      await call("c1");

      const args = lastArgs(prisma.contact.findUnique) as {
        include: { companyLocations: { orderBy: unknown } };
      };
      expect(args.include.companyLocations.orderBy).toEqual([{ is_primary: "desc" }, { found_count: "desc" }]);
    });

    it("returns an empty list when the contact has no locations", async () => {
      mockContact({ status: "DONE" });

      const result = (await (await call("c1")).json()) as ContactProfileResult;

      expect(result.locations).toEqual([]);
    });
  });

  it("returns 404 for an unknown id", async () => {
    vi.mocked(prisma.contact.findUnique).mockResolvedValueOnce(null);

    const response = await call("missing");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: "Contact not found.",
    });
  });
});
