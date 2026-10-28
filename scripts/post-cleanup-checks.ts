// scripts/post-cleanup-checks.ts
//
// Read-only health check for the cleaned database.
//
// Loads every contact and enrichment row, runs `detectFlags`, and prints a
// per-rule table with severities. Exits non-zero when any HIGH rule exceeds its
// threshold (default 0; a small allow-list covers rules whose rows are expected
// to sit in a review file). Writes `scripts/runs/post-cleanup-<ts>.hjson`.
//
// Flags: --dry-run (print only; do not write the artifact).
//
// Run: pnpm tsx scripts/post-cleanup-checks.ts [--dry-run]

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { stringify } from "hjson";
import { prisma } from "../lib/prisma";
import { isDryRun, runStamp, runsDir } from "./scriptAudit";
import {
  detectFlags,
  RULE_SEVERITY,
  type ContactLike,
  type EnrichmentLike,
  type Flag,
  type RuleId,
  type Severity,
} from "./cleaning/validators";
import { alnum } from "./cleaning/text";

const DRY_RUN = isDryRun();

/** HIGH rules allowed to keep a residual count (rows expected in review). */
const HIGH_THRESHOLDS: Partial<Record<RuleId, number>> = {
  COMPANY_IS_PERSON_NAME: 200,
  COMPANY_OCR_GARBAGE: 30,
  NAME_MOJIBAKE: 10,
  NAME_SOURCE_TAG: 40, // includes the 22 `china` sourcing leads (D6)
  EMAIL_INVALID: 15,
  TEL_BAD_LENGTH: 20,
  MOBILE_INVALID_LENGTH_OR_PREFIX: 20,
};

function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

async function main() {
  const contacts = await prisma.contact.findMany();
  const enrichments = await prisma.enrichment.findMany();
  const enrichmentByContact = new Map(enrichments.map((e) => [e.contact_id, e]));

  // Domain frequencies across the whole table (for OCR-variant detection).
  const domainFrequency = new Map<string, number>();
  for (const contact of contacts) {
    for (const email of contact.emails) {
      const domain = emailDomain(email);
      if (domain) domainFrequency.set(domain, (domainFrequency.get(domain) ?? 0) + 1);
    }
  }

  // Cross-row duplicate signals.
  const phoneCount = new Map<string, number>();
  const nameCount = new Map<string, number>();
  for (const contact of contacts) {
    const phones = new Set(
      [...contact.mobileNumbers, ...contact.telephoneNumbers]
        .map((p) => p.replace(/[^\d+]/g, ""))
        .filter(Boolean),
    );
    for (const phone of phones) phoneCount.set(phone, (phoneCount.get(phone) ?? 0) + 1);

    const nameKey = alnum(contact.fullName);
    if (nameKey) nameCount.set(nameKey, (nameCount.get(nameKey) ?? 0) + 1);
  }

  const sharedPhoneIds = new Set<string>();
  const duplicateNameIds = new Set<string>();
  for (const contact of contacts) {
    const phones = [...contact.mobileNumbers, ...contact.telephoneNumbers].map((p) =>
      p.replace(/[^\d+]/g, ""),
    );
    if (phones.some((p) => (phoneCount.get(p) ?? 0) > 1)) sharedPhoneIds.add(contact.id);
    const nameKey = alnum(contact.fullName);
    if (nameKey && (nameCount.get(nameKey) ?? 0) > 1) duplicateNameIds.add(contact.id);
  }

  const counts = new Map<RuleId, number>();
  const rowsByRule = new Map<RuleId, string[]>();

  for (const contact of contacts) {
    const enrichment = enrichmentByContact.get(contact.id) ?? null;
    const flags: Flag[] = detectFlags(
      contact as unknown as ContactLike,
      enrichment as unknown as EnrichmentLike,
      { domainFrequency, sharedPhoneIds, duplicateNameIds },
    );
    for (const flag of flags) {
      counts.set(flag.rule, (counts.get(flag.rule) ?? 0) + 1);
      const rows = rowsByRule.get(flag.rule) ?? [];
      if (rows.length < 20) rows.push(contact.id);
      rowsByRule.set(flag.rule, rows);
    }
  }

  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  const violations: { rule: RuleId; count: number; threshold: number }[] = [];

  console.log("rule".padEnd(40), "count".padStart(6), " severity");
  for (const rule of (Object.keys(RULE_SEVERITY) as RuleId[]).sort()) {
    const count = counts.get(rule) ?? 0;
    const severity = RULE_SEVERITY[rule];
    bySeverity[severity] += count;
    if (count > 0) {
      console.log(rule.padEnd(40), String(count).padStart(6), ` ${severity}`);
    }
    if (severity === "high" && count > (HIGH_THRESHOLDS[rule] ?? 0)) {
      violations.push({ rule, count, threshold: HIGH_THRESHOLDS[rule] ?? 0 });
    }
  }

  console.log(
    `\nseverity totals: high ${bySeverity.high}, medium ${bySeverity.medium}, ` +
      `low ${bySeverity.low}, info ${bySeverity.info}`,
  );
  console.log(`contacts: ${contacts.length}, enrichment rows: ${enrichments.length}`);

  const report = {
    generatedAt: new Date().toISOString(),
    contacts: contacts.length,
    enrichment: enrichments.length,
    bySeverity,
    counts: Object.fromEntries([...counts.entries()].sort()),
    violations,
  };

  if (DRY_RUN) {
    console.log("Dry run - no artifact written.");
  } else {
    const dir = runsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `post-cleanup-${runStamp()}.hjson`);
    fs.writeFileSync(file, stringify(report, { keepWsc: true }));
    console.log(`Report written to ${file}`);
  }

  if (violations.length > 0) {
    console.error(`\n${violations.length} HIGH rule(s) exceeded threshold:`);
    for (const v of violations) console.error(`  ${v.rule}: ${v.count} > ${v.threshold}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
