// scripts/backfill-location.ts
//
// Repairs and backfills Contact.companyLocation to a canonical Indian
// state/UT name (decision D3), using the shared pure repairer in
// scripts/cleaning/locationFix.ts.
//
//   - Values are REPAIRED, not merely filled: `:::` delimiter junk, separator-
//     only values, truncated names and address fragments are all normalised.
//   - A pincode beats free text when the two disagree (a `conflict` note is
//     recorded); an unknown pincode prefix falls through to review rather than
//     being guessed.
//   - Rows with no address fall back to Enrichment.location when present.
//   - Values already canonical and agreeing with the pincode are left untouched.
//
// Flags: --dry-run (no DB writes, still writes the audit + review artifacts).
//
// Run: npx tsx scripts/backfill-location.ts [--dry-run]

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ScriptAudit, isDryRun } from "./scriptAudit";
import { writeSnapshot } from "./scriptSnapshot";
import { repairCompanyLocation } from "./cleaning/locationFix";

const DRY_RUN = isDryRun();
const audit = new ScriptAudit("backfill-location", DRY_RUN);
const BATCH = 100;

function truncate(value: string | null, max = 120): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function main() {
  const contacts = await prisma.contact.findMany({
    select: {
      id: true,
      address: true,
      companyLocation: true,
      enrichment: { select: { location: true } },
    },
  });

  console.log(`Loaded ${contacts.length} rows.${DRY_RUN ? " (dry run)" : ""}`);

  const planned: { id: string; value: string }[] = [];
  const snapshotRows: Record<string, unknown>[] = [];

  let repaired = 0;
  let filled = 0;
  let fromEnrichment = 0;
  let unchanged = 0;
  let reviewCount = 0;

  for (const contact of contacts) {
    const current = contact.companyLocation ?? null;
    const address = contact.address ?? null;

    const repair = repairCompanyLocation(current ?? "", address);
    let value = repair.value;
    let source: string = repair.source;
    let confidence: string = repair.confidence;
    const conflict = repair.conflict;

    // No address: fall back to the worker-written enrichment.location text.
    if (value === null && !address && contact.enrichment?.location) {
      const alt = repairCompanyLocation(contact.enrichment.location, null);
      if (alt.value) {
        value = alt.value;
        source = "enrichment";
        confidence = alt.confidence;
      }
    }

    if (value === null) {
      if (repair.review) {
        reviewCount++;
        audit.review(contact.id, "companyLocation", {
          reason: repair.review,
          proposed: null,
          source,
          confidence,
        });
      }
      continue;
    }

    if (value === current) {
      unchanged++;
      continue;
    }

    if (source === "enrichment") fromEnrichment++;
    else if (current) repaired++;
    else filled++;

    audit.record(contact.id, "companyLocation", current, value, {
      address: truncate(address),
      source,
      confidence,
      ...(conflict ? { conflict } : {}),
    });
    planned.push({ id: contact.id, value });
    snapshotRows.push({ id: contact.id, address, companyLocation: current });
  }

  if (!DRY_RUN && planned.length > 0) {
    const file = writeSnapshot("backfill-location", snapshotRows);
    console.log(`Snapshot written to ${file} (${snapshotRows.length} rows)`);
  }

  let applied = 0;
  for (let i = 0; i < planned.length && !DRY_RUN; i += BATCH) {
    const batch = planned.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((change) =>
        prisma.contact.update({
          where: { id: change.id },
          data: { companyLocation: change.value },
        }),
      ),
    );
    applied += batch.length;
    console.log(`Applied ${applied}/${planned.length}`);
  }

  const summary =
    `Rows loaded: ${contacts.length}. Planned: ${planned.length}, applied: ${applied}. ` +
    `Repaired: ${repaired}. Filled (was empty): ${filled}. From enrichment: ${fromEnrichment}. ` +
    `Already canonical: ${unchanged}. Review: ${reviewCount}.`;
  console.log(summary);
  if (DRY_RUN) console.log("Dry run - no database writes were made.");
  audit.logRun(summary);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    audit.write();
    prisma.$disconnect();
  });
