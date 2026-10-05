// scripts/restore-snapshot.ts
//
// Restores before-image snapshots written by the cleanup scripts.
//
// Flags: --file=<snapshot.json> [--dry-run]
//
// Restores only whitelisted Contact columns, by id, inside a single transaction.
//
// Run: npx tsx scripts/restore-snapshot.ts --file=scripts/runs/phone-fields-....snapshot.json

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { isDryRun } from "./scriptAudit";
import { readSnapshot } from "./scriptSnapshot";

const DRY_RUN = isDryRun();
const fileArg = process.argv.find((a) => a.startsWith("--file="))?.split("=").slice(1).join("=");

const RESTORABLE_FIELDS = [
  "fullName",
  "jobTitle",
  "company",
  "mobileNumbers",
  "telephoneNumbers",
  "emails",
  "website",
  "address",
  "companyLocation",
  "linkedin",
  "rawNotes",
  "originalImageUrl",
] as const;

async function main() {
  if (!fileArg) {
    throw new Error("Missing --file=<snapshot.json>.");
  }

  const snapshot = readSnapshot(fileArg);
  console.log(
    `Restoring ${snapshot.rows.length} rows from ${fileArg} (script: ${snapshot.script}).` +
      (DRY_RUN ? " (dry run)" : ""),
  );

  const updates: { id: string; data: Record<string, unknown> }[] = [];
  for (const row of snapshot.rows) {
    const id = row[snapshot.key];
    if (typeof id !== "string") continue;
    const data: Record<string, unknown> = {};
    for (const field of RESTORABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(row, field)) {
        data[field] = row[field];
      }
    }
    if (Object.keys(data).length > 0) updates.push({ id, data });
  }

  console.log(`Prepared ${updates.length} restore updates.`);
  if (DRY_RUN) {
    console.log("Dry run - no database writes were made.");
    return;
  }

  await prisma.$transaction(
    updates.map((update) =>
      prisma.contact.update({
        where: { id: update.id },
        data: update.data,
      }),
    ),
    { maxWait: 60000, timeout: 120000 },
  );

  console.log(`Restored ${updates.length} rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    prisma.$disconnect();
  });
