// scripts/clean-contact-fields.ts
//
// Cleans one contact's emails, website and linkedin, plus mojibake in its text
// columns. Address is reported but never rewritten. Bulk runs were removed.
//
// Run: pnpm tsx scripts/clean-contact-fields.ts --id=<contactId> [--dry-run]

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
    printContactIdUsage("clean-contact-fields");
    process.exitCode = 1;
    return;
  }

  const result = await processContactById(id, {
    only: "fields",
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
