// Directory filter SQL, shared by GET /api/contacts and GET /api/locations/points
// so the table, its facet counts and the map always agree on which contacts match.

import { Prisma } from "@/lib/generated/prisma/client";
import { BLANK } from "@/lib/contact";
import type { FacetField } from "@/types/card";

/** Contact rows joined to enrichment. Aliases `c` and `e` are what the filters below use. */
export const FROM = Prisma.sql`FROM "Contact" c LEFT JOIN enrichment e ON e.contact_id = c.id`;

/** Escape LIKE wildcards so user input is matched literally. */
const like = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

/** Quoted column reference; only ever called with the literals below. */
const col = (name: string) => Prisma.raw(`c."${name}"`);

// Scalar facet expressions: trimmed value, or NULL when blank.
export const SCALAR = {
  company: Prisma.sql`NULLIF(btrim(c."company"), '')`,
  state: Prisma.sql`NULLIF(btrim(c."state"), '')`,
  country: Prisma.sql`NULLIF(btrim(c."country"), '')`,
  profile: Prisma.sql`CASE WHEN e.status = 'DONE' THEN 'Enriched' ELSE 'Pending' END`,
} as const;
export const FACETS: FacetField[] = ["company", "subsidiary", "profile", "state", "country"];

const Q_SCALARS = ["fullName", "jobTitle", "company", "website", "address", "companyLocation", "rawNotes"];
const Q_ARRAYS = ["emails", "mobileNumbers", "telephoneNumbers", "subsidiaryMatches"];
const TEXT_SCALARS: [string, string][] = [["name", "fullName"], ["jobTitle", "jobTitle"], ["website", "website"]];
const TEXT_ARRAYS: [string, string][] = [["email", "emails"], ["mobile", "mobileNumbers"], ["telephone", "telephoneNumbers"]];

/**
 * WHERE clause for the active contacts matching the search and filter params.
 * Every filter except the `exclude` facet's own is applied, so each facet's
 * counts cascade off the other selections.
 */
export function buildContactsWhere(params: URLSearchParams, exclude?: FacetField): Prisma.Sql {
  const q = params.get("q")?.trim();
  const text = (key: string) => params.get(key)?.trim() || undefined;

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
    if (v === BLANK) conds.push(Prisma.sql`NULLIF(btrim(${col(name)}), '') IS NULL`);
    else if (v) conds.push(Prisma.sql`${col(name)} ILIKE ${like(v)}`);
  }
  for (const [key, name] of TEXT_ARRAYS) {
    const v = text(key);
    if (v === BLANK) conds.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM unnest(${col(name)}) x WHERE btrim(x) <> '')`);
    else if (v) conds.push(Prisma.sql`EXISTS (SELECT 1 FROM unnest(${col(name)}) x WHERE x ILIKE ${like(v)})`);
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
}
