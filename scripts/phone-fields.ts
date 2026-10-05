// scripts/phone-fields.ts
//
// Normalises Contact.mobileNumbers / telephoneNumbers to E.164 (decision D2) and
// moves misclassified numbers to the correct array.
//
//   - Every number in either array is parsed with libphonenumber-js; a number is
//     a mobile only if it actually parses as one (the old "10 digits starting
//     6-9" shortcut promoted landlines and is gone).
//   - Valid numbers are rewritten as E.164. Extensions are kept as a
//     ` xNNNN` suffix on the landline (D2).
//   - Invalid / unparseable values stay in their original array, unchanged, and
//     are written to the review file with a reason.
//   - Concatenated numbers that split cleanly become separate entries.
//
// Flags: --dry-run (no DB writes, still writes the audit + review artifacts).
//
// Run: npx tsx scripts/phone-fields.ts [--dry-run]

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ScriptAudit, isDryRun } from "./scriptAudit";
import { writeSnapshot } from "./scriptSnapshot";
import { normalizeNumberSets, parsePhone } from "./cleaning/phone";

const DRY_RUN = isDryRun();
const audit = new ScriptAudit("phone-fields", DRY_RUN);
const BATCH = 100;

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

interface PlannedChange {
  id: string;
  mobileNumbers: string[];
  telephoneNumbers: string[];
}

async function main() {
  const contacts = await prisma.contact.findMany({
    where: {
      OR: [
        { mobileNumbers: { isEmpty: false } },
        { telephoneNumbers: { isEmpty: false } },
      ],
    },
  });

  console.log(`Loaded ${contacts.length} rows.${DRY_RUN ? " (dry run)" : ""}`);

  const planned: PlannedChange[] = [];
  const snapshotRows: Record<string, unknown>[] = [];

  let movedToMobile = 0;
  let landlinesResolved = 0;
  let duplicatesRemoved = 0;
  let invalidCount = 0;
  let splitCount = 0;

  for (const contact of contacts) {
    const mobilesIn = strArray(contact.mobileNumbers);
    const telsIn = strArray(contact.telephoneNumbers);

    // Capture extensions before normalization drops them from the parsed result.
    const extByE164 = new Map<string, string>();
    for (const raw of [...mobilesIn, ...telsIn]) {
      const parsed = parsePhone(raw);
      if (parsed.e164 && parsed.ext) extByE164.set(parsed.e164, parsed.ext);
    }

    const { mobiles, tels, review } = normalizeNumberSets({
      mobiles: mobilesIn,
      tels: telsIn,
    });
    const telsFinal = tels.map((tel) => {
      const ext = extByE164.get(tel);
      return ext ? `${tel} x${ext}` : tel;
    });

    for (const item of review) {
      invalidCount++;
      audit.review(contact.id, "phoneNumbers", {
        reason: item.reason,
        proposed: item.raw,
        source: "phone-fields",
      });
    }

    for (const raw of telsIn) {
      const parsed = parsePhone(raw);
      if (parsed.kind === "LANDLINE" || parsed.kind === "TOLL_FREE") landlinesResolved++;
    }

    const mobilesBefore = new Set(
      mobilesIn.map((raw) => parsePhone(raw).e164).filter((v): v is string => !!v),
    );
    for (const mobile of mobiles) {
      if (!mobilesBefore.has(mobile)) movedToMobile++;
    }

    const beforeTotal = mobilesIn.length + telsIn.length;
    const afterTotal = mobiles.length + telsFinal.length;
    if (afterTotal < beforeTotal) duplicatesRemoved += beforeTotal - afterTotal;
    if (afterTotal > beforeTotal) {
      splitCount += afterTotal - beforeTotal;
    }

    if (!sameArray(mobilesIn, mobiles) || !sameArray(telsIn, telsFinal)) {
      planned.push({ id: contact.id, mobileNumbers: mobiles, telephoneNumbers: telsFinal });
      snapshotRows.push(contact as unknown as Record<string, unknown>);

      audit.record(contact.id, "mobileNumbers", mobilesIn, mobiles);
      if (!sameArray(telsIn, telsFinal)) {
        audit.record(contact.id, "telephoneNumbers", telsIn, telsFinal);
      }
    }
  }

  if (!DRY_RUN && planned.length > 0) {
    const file = writeSnapshot("phone-fields", snapshotRows);
    console.log(`Snapshot written to ${file} (${snapshotRows.length} rows)`);
  }

  let applied = 0;
  for (let i = 0; i < planned.length && !DRY_RUN; i += BATCH) {
    const batch = planned.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((change) =>
        prisma.contact.update({
          where: { id: change.id },
          data: {
            mobileNumbers: change.mobileNumbers,
            telephoneNumbers: change.telephoneNumbers,
          },
        }),
      ),
    );
    applied += batch.length;
    console.log(`Applied ${applied}/${planned.length}`);
  }

  const summary =
    `Rows loaded: ${contacts.length}. ` +
    `Changed: ${planned.length}, applied: ${applied}. ` +
    `Moved to mobile: ${movedToMobile}. Landlines resolved: ${landlinesResolved}. ` +
    `Duplicates removed: ${duplicatesRemoved}. Concatenations split: ${splitCount}. ` +
    `Invalid/Review: ${invalidCount}.`;
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
