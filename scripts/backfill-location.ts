// scripts/backfill-location.ts
//
// Repairs one contact's companyLocation to a canonical Indian state/UT name.
// Falls back to Enrichment.location when the contact has no address. Bulk runs
// were removed.
//
// Run: pnpm tsx scripts/backfill-location.ts --id=<contactId> [--dry-run]

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
    printContactIdUsage("backfill-location");
    process.exitCode = 1;
    return;
  }

  const result = await processContactById(id, {
    only: "location",
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
