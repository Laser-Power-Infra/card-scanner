import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/locations/points/route";

const get = (qs = "") =>
  GET(new NextRequest(new URL(`/api/locations/points${qs ? `?${qs}` : ""}`, "http://localhost")));

const sqlCalls = () =>
  vi.mocked(prisma.$queryRaw).mock.calls.map((c) => c[0] as unknown as { sql: string; values: unknown[] });

const row = (over: Record<string, unknown> = {}) => ({
  id: "loc1",
  contactId: "c1",
  fullName: "A. Person",
  company: "ACME Cables",
  address: "12 Mill Rd",
  city: "Pune",
  state: "Maharashtra",
  country: "India",
  lat: 18.52,
  lng: 73.85,
  isPrimary: true,
  status: "VERIFIED",
  precision: "STREET",
  ...over,
});

beforeEach(() => vi.mocked(prisma.$queryRaw).mockReset().mockResolvedValue([]));

describe("GET /api/locations/points", () => {
  it("returns one point per location with a City, State label and the contact totals", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([row(), row({ id: "loc2", isPrimary: false, state: null, country: "India", city: "Surat" })])
      .mockResolvedValueOnce([{ contacts: 5, plotted: 1 }]);

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.contactsTotal).toBe(5);
    expect(body.contactsPlotted).toBe(1);
    expect(body.truncated).toBe(false);
    expect(body.points).toHaveLength(2);
    expect(body.points[0]).toMatchObject({
      id: "loc1",
      contactId: "c1",
      label: "Pune, Maharashtra",
      lat: 18.52,
      lng: 73.85,
      isPrimary: true,
      status: "VERIFIED",
      precision: "STREET",
    });
    // No state: falls back to the country.
    expect(body.points[1].label).toBe("Surat, India");
  });

  it("falls back to the street line when a row has no city, state or country", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([row({ city: null, state: null, country: null })])
      .mockResolvedValueOnce([{ contacts: 1, plotted: 1 }]);

    expect((await (await get()).json()).points[0].label).toBe("12 Mill Rd");
  });

  it("caps the response and reports truncated when the limit is exceeded", async () => {
    const many = Array.from({ length: 5001 }, (_, i) => row({ id: `loc${i}` }));
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce(many)
      .mockResolvedValueOnce([{ contacts: 6000, plotted: 5001 }]);

    const body = await (await get()).json();

    expect(body.points).toHaveLength(5000);
    expect(body.truncated).toBe(true);
  });

  it("only plots active contacts with in-range coordinates", async () => {
    await get();

    const [pointsSql] = sqlCalls();
    expect(pointsSql.sql).toContain(`"status" = 'active'`);
    expect(pointsSql.sql).toContain("l.latitude BETWEEN -90 AND 90");
    expect(pointsSql.sql).toContain("l.longitude BETWEEN -180 AND 180");
    expect(pointsSql.sql).toContain(`JOIN "CompanyLocation" l ON l.contact_id = c.id`);
  });

  it("applies the same search and facet filters as the table, as bound parameters", async () => {
    await get("q=50%25&state=Karnataka&state=Kerala");

    for (const c of sqlCalls()) {
      expect(c.sql).not.toContain("Karnataka");
      expect(c.values).toContain("%50\\%%");
      expect(c.values).toContainEqual(["Karnataka", "Kerala"]);
    }
  });

  it("answers 500 with the error envelope when the query fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("boom"));

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to fetch map points" });
    spy.mockRestore();
  });
});
