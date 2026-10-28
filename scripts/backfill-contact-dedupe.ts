// scripts/backfill-contact-dedupe.ts
//
// Persists duplicate hiding: recomputes Contact.state/country/dedupeKey via
// contactDerivedFields() and sets status. Within each dedupeKey the NEWEST row
// (createdAt desc, id desc) stays `active`; older ones become `inactive`.
// Rows with a null key (empty rows) stay `active`.
//
// Idempotent: only rows whose state/country/dedupeKey/status differ are written.
//
// Flags: --dry-run (no DB writes; prints what would change).
//
// Run: pnpm tsx scripts/backfill-contact-dedupe.ts [--dry-run]

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { isDryRun } from "./scriptAudit";
import { contactDerivedFields } from "../lib/contact";

const DRY_RUN = isDryRun();
const BATCH = 50;
const TX_TIMEOUT = 60000;

type Status = "active" | "inactive";

async function main() {
  const rows = await prisma.contact.findMany({
    select: {
      id: true,
      emails: true,
      mobileNumbers: true,
      telephoneNumbers: true,
      fullName: true,
      company: true,
      address: true,
      companyLocation: true,
      state: true,
      country: true,
      dedupeKey: true,
      status: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  console.log(`Loaded ${rows.length} rows.${DRY_RUN ? " (dry run)" : ""}`);

  const seen = new Map<string, string[]>(); // key -> ids, newest first
  const planned: {
    id: string;
    data: { state: string | null; country: string | null; dedupeKey: string | null; status: Status };
  }[] = [];
  let active = 0;
  let inactive = 0;
  let nullKey = 0;

  for (const row of rows) {
    const { state, country, dedupeKey } = contactDerivedFields(row);
    let status: Status = "active";
    if (dedupeKey === null) {
      nullKey++;
    } else {
      const ids = seen.get(dedupeKey);
      if (ids) {
        ids.push(row.id);
        status = "inactive";
      } else {
        seen.set(dedupeKey, [row.id]);
      }
    }
    if (status === "active") active++;
    else inactive++;

    if (
      row.state !== state ||
      row.country !== country ||
      row.dedupeKey !== dedupeKey ||
      row.status !== status
    ) {
      planned.push({ id: row.id, data: { state, country, dedupeKey, status } });
    }
  }

  const groups = [...seen.entries()].filter(([, ids]) => ids.length > 1);
  console.log(`Duplicate groups: ${groups.length}. Examples (first id is kept active):`);
  for (const [key, ids] of groups.slice(0, 5)) {
    console.log(`  ${key.slice(0, 80)} -> ${ids.slice(0, 6).join(", ")}${ids.length > 6 ? ", ..." : ""}`);
  }

  let applied = 0;
  for (let i = 0; i < planned.length && !DRY_RUN; i += BATCH) {
    const batch = planned.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((c) => prisma.contact.update({ where: { id: c.id }, data: c.data })),
      { maxWait: TX_TIMEOUT, timeout: TX_TIMEOUT },
    );
    applied += batch.length;
    console.log(`Applied ${applied}/${planned.length}`);
  }

  console.log(
    `Total: ${rows.length}. Active: ${active}. Inactive (duplicates): ${inactive}. ` +
      `Null-key: ${nullKey}. Rows changed: ${DRY_RUN ? `${planned.length} (would change)` : applied}.`,
  );
  if (DRY_RUN) console.log("Dry run - no database writes were made.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    prisma.$disconnect();
  });
