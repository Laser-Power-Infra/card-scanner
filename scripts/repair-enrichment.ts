// scripts/repair-enrichment.ts
//
// Repairs Enrichment rows:
//   1. A `DONE` row whose summary/career_background says the person was NOT
//      verified is downgraded to `PARTIAL` (the phrase is recorded).
//   2. `enriched_at` is backfilled to `updated_at` ONLY for DONE/PARTIAL rows
//      that have it null (decision D4). Counters are never touched.
//   3. An `official_site` host that disagrees with the contact website is
//      review-only.
//   4. `--requeue=<file>` publishes a `research` task per listed contact id.
//
// WARNING: the external worker (another repo) owns Enrichment.status. Coordinate
// with its owners before applying step 1 outside a scratch database.
//
// Flags: --dry-run | --requeue=<file>
//
// Run: npx tsx scripts/repair-enrichment.ts [--dry-run]

import "dotenv/config";
import * as fs from "fs";
import { prisma } from "../lib/prisma";
import { ScriptAudit, isDryRun } from "./scriptAudit";
import { writeSnapshot } from "./scriptSnapshot";
import { publishProfileCollectionTask } from "../lib/queue/profileCollection";
import type { CardData } from "../types/card";

const DRY_RUN = isDryRun();
const REQUEUE_FILE = process.argv
  .find((a) => a.startsWith("--requeue="))
  ?.split("=")
  .slice(1)
  .join("=");
const audit = new ScriptAudit("repair-enrichment", DRY_RUN);
const BATCH = 50;
const TX_TIMEOUT = 60000;

const UNVERIFIED =
  /did not clearly|does not clearly|do not clearly|could not be confirmed|no reliable|not clearly identify|unable to (?:verify|find)|no verified|not publicly/i;

function hostOf(value: string | null): string | null {
  if (!value) return null;
  const stripped = value.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0];
  return stripped ? stripped.toLowerCase().replace(/^www\./, "") : null;
}

function toCardData(contact: {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
  mobileNumbers: string[];
  telephoneNumbers: string[];
  emails: string[];
  website: string | null;
  address: string | null;
  companyLocation: string | null;
  linkedin: string | null;
  rawNotes: string | null;
  originalImageUrl: string | null;
}): CardData {
  return {
    id: contact.id,
    fullName: contact.fullName,
    jobTitle: contact.jobTitle,
    company: contact.company,
    mobileNumbers: contact.mobileNumbers,
    telephoneNumbers: contact.telephoneNumbers,
    emails: contact.emails,
    website: contact.website,
    address: contact.address,
    companyLocation: contact.companyLocation,
    linkedin: contact.linkedin,
    otherSocials: [],
    rawNotes: contact.rawNotes,
    originalImageUrl: contact.originalImageUrl,
  };
}

async function main() {
  const rows = await prisma.enrichment.findMany({
    include: {
      contact: {
        select: { website: true, fullName: true, company: true },
      },
    },
  });
  console.log(`Loaded ${rows.length} enrichment rows.${DRY_RUN ? " (dry run)" : ""}`);

  const planned: { id: string; status?: "PARTIAL"; enriched_at?: Date }[] = [];
  const snapshotRows: Record<string, unknown>[] = [];
  let downgraded = 0;
  let enrichedAtBackfilled = 0;
  let siteMismatch = 0;

  for (const row of rows) {
    const patch: { id: string; status?: "PARTIAL"; enriched_at?: Date } = { id: row.contact_id };
    const text = `${row.summary ?? ""} ${row.career_background ?? ""}`;

    if (row.status === "DONE" && UNVERIFIED.test(text)) {
      patch.status = "PARTIAL";
      downgraded++;
      audit.record(row.contact_id, "status", row.status, "PARTIAL", {
        phrase: text.match(UNVERIFIED)?.[0] ?? null,
      });
    }

    const terminal = row.status === "DONE" || row.status === "PARTIAL" || patch.status === "PARTIAL";
    if (terminal && !row.enriched_at) {
      patch.enriched_at = row.updated_at;
      enrichedAtBackfilled++;
      audit.record(row.contact_id, "enriched_at", null, row.updated_at.toISOString(), {
        reason: "backfill from updated_at",
      });
    }

    const officialHost = hostOf(row.official_site);
    const siteHost = hostOf(row.contact?.website ?? null);
    if (officialHost && siteHost && officialHost !== siteHost) {
      siteMismatch++;
      audit.review(row.contact_id, "official_site", {
        reason: "enr_site_mismatch_contact",
        proposed: officialHost,
        source: siteHost,
      });
    }

    if (patch.status || patch.enriched_at) {
      planned.push(patch);
      snapshotRows.push({
        contact_id: row.contact_id,
        status: row.status,
        enriched_at: row.enriched_at,
        updated_at: row.updated_at,
      });
    }
  }

  if (!DRY_RUN && planned.length > 0) {
    const file = writeSnapshot("repair-enrichment", snapshotRows, "contact_id");
    console.log(`Snapshot written to ${file} (${snapshotRows.length} rows)`);
  }

  let applied = 0;
  for (let i = 0; i < planned.length && !DRY_RUN; i += BATCH) {
    const batch = planned.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((change) =>
        prisma.enrichment.update({
          where: { contact_id: change.id },
          data: {
            ...(change.status ? { status: change.status } : {}),
            ...(change.enriched_at ? { enriched_at: change.enriched_at } : {}),
          },
        }),
      ),
      { timeout: TX_TIMEOUT },
    );
    applied += batch.length;
    console.log(`Applied ${applied}/${planned.length}`);
  }

  let requeued = 0;
  let requeueFailed = 0;
  if (REQUEUE_FILE) {
    const parsed = JSON.parse(fs.readFileSync(REQUEUE_FILE, "utf8")) as
      | string[]
      | { ids: string[] };
    const ids = Array.isArray(parsed) ? parsed : parsed.ids;
    const contacts = await prisma.contact.findMany({ where: { id: { in: ids } } });
    for (const contact of contacts) {
      if (DRY_RUN) {
        requeued++;
        continue;
      }
      const ok = await publishProfileCollectionTask({
        tag: "research",
        contactId: contact.id,
        contact: toCardData(contact),
        timestamp: Date.now(),
      });
      if (ok) requeued++;
      else requeueFailed++;
    }
  }

  const summary =
    `Rows loaded: ${rows.length}. Downgraded DONE->PARTIAL: ${downgraded}. ` +
    `enriched_at backfilled: ${enrichedAtBackfilled}. Site mismatches (review): ${siteMismatch}. ` +
    `Requeued: ${requeued}, publish failed: ${requeueFailed}.`;
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
