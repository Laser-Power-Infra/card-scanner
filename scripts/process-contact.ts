// scripts/process-contact.ts
//
// Runs the full per-contact cleanup pipeline: phones, fields, name/job/company,
// location, derived state/country/dedupeKey and dedupe status. This is the
// manual recovery entry point for a failed new-contact event.
//
// Flags: --id=<contactId> | --dry-run | --no-llm
//
// Run: pnpm tsx scripts/process-contact.ts --id=<contactId> [--dry-run] [--no-llm]

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
    printContactIdUsage("process-contact");
    process.exitCode = 1;
    return;
  }

  const result = await processContactById(id, {
    dryRun: process.argv.includes("--dry-run"),
    llm: !process.argv.includes("--no-llm"),
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
