import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/permissions";
import { Prisma } from "@/lib/generated/prisma/client";
import { BLANK } from "@/lib/contact";
import type { ContactsPageResponse, FacetField, FacetValue } from "@/types/card";

const DEFAULT_PAGE_SIZE = 25;
/** Upper bound on a single page, so a caller cannot ask for the whole table. */
const MAX_PAGE_SIZE = 200;

const FROM = Prisma.sql`FROM "Contact" c LEFT JOIN enrichment e ON e.contact_id = c.id`;

/** Escape LIKE wildcards so user input is matched literally. */
const like = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

const clampInt = (v: string | null, def: number, min: number, max: number) =>
  Math.min(Math.max(Number.parseInt(v ?? "", 10) || def, min), max);

/** Quoted column reference; only ever called with the literals below. */
const col = (name: string) => Prisma.raw(`c."${name}"`);

// Scalar facet expressions: trimmed value, or NULL when blank.
const SCALAR = {
  company: Prisma.sql`NULLIF(btrim(c."company"), '')`,
  state: Prisma.sql`NULLIF(btrim(c."state"), '')`,
  country: Prisma.sql`NULLIF(btrim(c."country"), '')`,
  profile: Prisma.sql`CASE WHEN e.status = 'DONE' THEN 'Enriched' ELSE 'Pending' END`,
} as const;
const FACETS: FacetField[] = ["company", "subsidiary", "profile", "state", "country"];

const Q_SCALARS = ["fullName", "jobTitle", "company", "website", "address", "companyLocation", "rawNotes"];
const Q_ARRAYS = ["emails", "mobileNumbers", "telephoneNumbers", "subsidiaryMatches"];
const TEXT_SCALARS: [string, string][] = [["name", "fullName"], ["jobTitle", "jobTitle"], ["website", "website"]];
const TEXT_ARRAYS: [string, string][] = [["email", "emails"], ["mobile", "mobileNumbers"], ["telephone", "telephoneNumbers"]];

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

    const q = params.get("q")?.trim();
    const text = (key: string) => params.get(key)?.trim() || undefined;

    // Every filter except the `exclude` facet's own, so each facet's counts
    // cascade off the other selections.
    const where = (exclude?: FacetField): Prisma.Sql => {
      const conds: Prisma.Sql[] = [Prisma.sql`c."status" = 'active'`];

      if (q) {
        const p = like(q);
        conds.push(
          Prisma.sql`(${Prisma.join(
            [
              ...Q_SCALARS.map((s) => Prisma.sql`${col(s)} ILIKE ${p}`),
              ...Q_ARRAYS.map((a) => Prisma.sql`array_to_string(${col(a)}, ' ') ILIKE ${p}`),
            ],
            " OR "
          )})`
        );
      }

      for (const [key, name] of TEXT_SCALARS) {
        const v = text(key);
        if (v) conds.push(Prisma.sql`${col(name)} ILIKE ${like(v)}`);
      }
      for (const [key, name] of TEXT_ARRAYS) {
        const v = text(key);
        if (v) conds.push(Prisma.sql`EXISTS (SELECT 1 FROM unnest(${col(name)}) x WHERE x ILIKE ${like(v)})`);
      }

      for (const key of FACETS) {
        const vals = params.getAll(key);
        if (key === exclude || vals.length === 0) continue;
        const blank = vals.includes(BLANK);
        if (key === "subsidiary") {
          const hit = Prisma.sql`EXISTS (SELECT 1 FROM unnest(c."subsidiaryMatches") x WHERE btrim(x) = ANY(${vals}::text[]))`;
          const none = Prisma.sql`NOT EXISTS (SELECT 1 FROM unnest(c."subsidiaryMatches") x WHERE btrim(x) <> '')`;
          conds.push(blank ? Prisma.sql`(${hit} OR ${none})` : hit);
        } else {
          const expr = SCALAR[key];
          const hit = Prisma.sql`${expr} = ANY(${vals}::text[])`;
          conds.push(blank ? Prisma.sql`(${hit} OR ${expr} IS NULL)` : hit);
        }
      }

      return Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`;
    };

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
