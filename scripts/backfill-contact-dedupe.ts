// scripts/backfill-contact-dedupe.ts
//
// Recomputes one contact's state/country/dedupeKey and reconciles the
// active/inactive status for its dedupe group. The newest row in a group stays
// active; older rows become inactive. Only rows sharing that contact's key are
// touched. Bulk runs were removed.
//
// Run: pnpm tsx scripts/backfill-contact-dedupe.ts --id=<contactId> [--dry-run]

import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  parseContactIdArg,
  printContactIdUsage,
  processContactById,
} from "../lib/contactPipeline";

async function main() {
  const id = parseContactIdArg();
  if (!id) {
    printContactIdUsage("backfill-contact-dedupe");
    process.exitCode = 1;
    return;
  }

  const result = await processContactById(id, {
    only: "dedupe",
    dryRun: process.argv.includes("--dry-run"),
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    prisma.$disconnect();
  });
