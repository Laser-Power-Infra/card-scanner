import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { FROM, buildContactsWhere } from "@/lib/contacts-query";
import type { LocationPoint, LocationPointsResponse } from "@/types/card";

/** Hard cap on pins per response; `truncated` tells the map when it was hit. */
const MAX_POINTS = 5000;

type Row = {
  id: string;
  contactId: string;
  fullName: string | null;
  company: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  lat: number;
  lng: number;
  isPrimary: boolean;
  status: LocationPoint["status"];
  precision: LocationPoint["precision"];
};

const labelOf = (r: Row) => {
  const place = [r.city, r.state || r.country].map((p) => p?.trim()).filter(Boolean).join(", ");
  return place || r.address?.trim() || null;
};

export async function GET(req: NextRequest) {
  // Public by decision, like /api/contacts: the card fields and addresses it
  // exposes are already world-readable. See PUBLIC_API_PATHS in
  // lib/permissions.ts. Only map-facing fields are selected: no enrichment, no
  // source URLs, no evidence flags.
  try {
    const params = new URL(req.url).searchParams;
    // The same search/filter params the table sends, so the map shows exactly
    // the contacts the table is filtered to.
    const w = buildContactsWhere(params);

    const [rows, totals] = await Promise.all([
      prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT l.id, l.contact_id AS "contactId", c."fullName", c.company,
               l.address_line1 AS address, l.city, l.state, l.country,
               l.latitude AS lat, l.longitude AS lng,
               l.is_primary AS "isPrimary", l.status::text AS status, l.precision::text AS precision
        ${FROM}
        JOIN "CompanyLocation" l ON l.contact_id = c.id
        ${w}
          AND l.latitude BETWEEN -90 AND 90
          AND l.longitude BETWEEN -180 AND 180
        ORDER BY l.is_primary DESC, l.id
        LIMIT ${MAX_POINTS + 1}`),
      prisma.$queryRaw<{ contacts: number; plotted: number }[]>(Prisma.sql`
        SELECT count(*)::int AS contacts,
               (count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM "CompanyLocation" l
                 WHERE l.contact_id = c.id AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
               )))::int AS plotted
        ${FROM} ${w}`),
    ]);

    const truncated = rows.length > MAX_POINTS;
    const points: LocationPoint[] = rows.slice(0, MAX_POINTS).map((r) => ({
      id: r.id,
      contactId: r.contactId,
      fullName: r.fullName,
      company: r.company,
      label: labelOf(r),
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      isPrimary: r.isPrimary,
      status: r.status,
      precision: r.precision,
    }));

    const body: LocationPointsResponse = {
      points,
      contactsTotal: totals[0]?.contacts ?? 0,
      contactsPlotted: totals[0]?.plotted ?? 0,
      truncated,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[Locations] Failed to fetch map points:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch map points" }, { status: 500 });
  }
}
