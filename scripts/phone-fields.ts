// scripts/phone-fields.ts
//
// Normalises one contact's mobileNumbers / telephoneNumbers to E.164 and moves
// misclassified numbers to the correct array. Bulk runs were removed: pass the
// contact id explicitly.
//
// Run: pnpm tsx scripts/phone-fields.ts --id=<contactId> [--dry-run]

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
    printContactIdUsage("phone-fields");
    process.exitCode = 1;
    return;
  }

  const result = await processContactById(id, {
    only: "phones",
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
