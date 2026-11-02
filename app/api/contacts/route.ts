import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/permissions";
import { Prisma } from "@/lib/generated/prisma/client";
import { BLANK } from "@/lib/contact";
import { FACETS, FROM, SCALAR, buildContactsWhere } from "@/lib/contacts-query";
import type { ContactsPageResponse, FacetField, FacetValue } from "@/types/card";

const DEFAULT_PAGE_SIZE = 25;
/** Upper bound on a single page, so a caller cannot ask for the whole table. */
const MAX_PAGE_SIZE = 200;

const clampInt = (v: string | null, def: number, min: number, max: number) =>
  Math.min(Math.max(Number.parseInt(v ?? "", 10) || def, min), max);

export async function GET(req: NextRequest) {
  // Not `requireApiSession()`: the directory is public by decision, and this
  // route shapes its response instead of refusing. An anonymous caller gets the
  // contact rows with `enrichment` narrowed to `status` -- enough for the
  // Enriched/Pending column and its filter, and nothing else.
  const session = await getCurrentSession();

  try {
    const params = new URL(req.url).searchParams;
    const page = clampInt(params.get("page"), 1, 1, 1_000_000);
    const pageSize = clampInt(params.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    const where = (exclude?: FacetField): Prisma.Sql => buildContactsWhere(params, exclude);

    // ponytail: facets return every distinct value. If payloads grow, upgrade to
    // a per-facet search + LIMIT.
    // NULL (blank) sorts first and becomes BLANK in JS: binding BLANK into the
    // SQL would give the SELECT and ORDER BY different $n params, which
    // Postgres rejects against GROUP BY.
    const facetQuery = async (f: FacetField): Promise<FacetValue[]> => {
      const w = where(f);
      const sql =
        f === "subsidiary"
          ? Prisma.sql`SELECT NULLIF(btrim(v), '') AS value, count(DISTINCT c.id)::int AS count
              ${FROM} LEFT JOIN LATERAL unnest(c."subsidiaryMatches") v ON true ${w}
              GROUP BY 1 ORDER BY 1 NULLS FIRST`
          : Prisma.sql`SELECT ${SCALAR[f]} AS value, count(*)::int AS count
              ${FROM} ${w}
              GROUP BY 1 ORDER BY 1 NULLS FIRST`;
      const rows = await prisma.$queryRaw<{ value: string | null; count: number }[]>(sql);
      return rows.map((r) => ({ value: r.value ?? BLANK, count: r.count }));
    };

    const w = where();
    const [countRows, idRows, ...facetRows] = await Promise.all([
      prisma.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT count(*)::int AS count ${FROM} ${w}`),
      prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT c.id ${FROM} ${w} ORDER BY c."createdAt" DESC, c.id DESC LIMIT ${pageSize} OFFSET ${offset}`
      ),
      ...FACETS.map(facetQuery),
    ]);

    // Always called, even with no ids: the visibility tests inspect its args.
    const items = await prisma.contact.findMany({
      where: { id: { in: idRows.map((r) => r.id) } },
      include: {
        enrichment: session ? true : { select: { status: true } },
        // The worker-found locations (max 3 per contact): the table's Location
        // column. No source URLs or evidence flags, and the same for anonymous
        // callers: addresses are already part of the public card fields.
        companyLocations: {
          select: {
            id: true,
            address_line1: true,
            city: true,
            state: true,
            country: true,
            latitude: true,
            longitude: true,
            is_primary: true,
            status: true,
            precision: true,
          },
          orderBy: [{ is_primary: "desc" }, { found_count: "desc" }],
        },
      },
      // id is the tiebreak when two rows share a createdAt (bulk import).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const body = {
      items,
      total: countRows[0]?.count ?? 0,
      page,
      pageSize,
      facets: Object.fromEntries(FACETS.map((f, i) => [f, facetRows[i]])),
    } as unknown as ContactsPageResponse;

    return NextResponse.json(body);
  } catch (error) {
    console.error("[Contacts] Failed to fetch contacts:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch contacts",
      },
      {
        status: 500,
      }
    );
  }
}
