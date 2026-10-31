// scripts/clean-name-job-company.ts
//
// Cleans one contact's fullName, jobTitle and company. Deterministic rules run
// first; the LLM is called only when the row still has suspicion flags. Bulk
// runs were removed.
//
// Flags: --id=<contactId> | --dry-run | --no-llm
//
// Run: pnpm tsx scripts/clean-name-job-company.ts --id=<contactId> [--dry-run] [--no-llm]

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
    printContactIdUsage("clean-name-job-company");
    process.exitCode = 1;
    return;
  }

  const result = await processContactById(id, {
    only: "person",
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
