// scripts/dedupeContacts.ts
//
// Phase A (default): read-only duplicate report using union-find over
// normalized keys. Writes `scripts/runs/dedupe-<ts>.json` with the evidence,
// a recommended survivor, and a confidence per group.
//
// Phase B (gated): `--apply-merges=<approved.json>` merges ONLY the groups in a
// human-approved file. There is no auto-merge flag. Each merge snapshots the
// rows, fills nulls on the survivor, unions the arrays, and deletes the losers
// (their Enrichment rows cascade).
//
// Flags: --dry-run | --apply-merges=<file>
//
// Run: npx tsx scripts/dedupeContacts.ts [--dry-run]
//      npx tsx scripts/dedupeContacts.ts --apply-merges=approved.json

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../lib/prisma";
import { ScriptAudit, isDryRun, runStamp, runsDir } from "./scriptAudit";
import { writeSnapshot } from "./scriptSnapshot";
import { alnum } from "./cleaning/text";
import { canonicalCompanyKey } from "./cleaning/company";
import { parsePhone } from "./cleaning/phone";

const DRY_RUN = isDryRun();
const MERGE_FILE = process.argv
  .find((a) => a.startsWith("--apply-merges="))
  ?.split("=")
  .slice(1)
  .join("=");
const audit = new ScriptAudit("dedupeContacts", DRY_RUN);

type Contact = Awaited<ReturnType<typeof prisma.contact.findMany>>[number];

const NON_NULL_FIELDS = [
  "fullName",
  "jobTitle",
  "company",
  "website",
  "address",
  "companyLocation",
  "linkedin",
  "rawNotes",
] as const;

function normalPhones(values: string[]): string[] {
  return values.map((v) => parsePhone(v).e164 ?? v.replace(/[^\d+]/g, "")).filter(Boolean);
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent || parent === id) {
      this.parent.set(id, id);
      return id;
    }
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

function buildGroups(contacts: Contact[]): { ids: string[]; evidence: string[]; strong: boolean }[] {
  const uf = new UnionFind();
  const evidenceById = new Map<string, Set<string>>();
  const strongRoots = new Set<string>();

  const addEvidence = (id: string, text: string, strong: boolean) => {
    const set = evidenceById.get(id) ?? new Set<string>();
    set.add(text);
    evidenceById.set(id, set);
    if (strong) strongRoots.add(uf.find(id));
  };

  const emailMap = new Map<string, string[]>();
  const mobileMap = new Map<string, string[]>();
  const telMap = new Map<string, string[]>();
  const nameCompanyMap = new Map<string, string[]>();

  for (const contact of contacts) {
    for (const email of contact.emails) {
      const key = `email:${email.toLowerCase()}`;
      emailMap.set(key, [...(emailMap.get(key) ?? []), contact.id]);
    }
    for (const mobile of normalPhones(contact.mobileNumbers)) {
      const key = `mobile:${mobile}`;
      mobileMap.set(key, [...(mobileMap.get(key) ?? []), contact.id]);
    }
    for (const tel of normalPhones(contact.telephoneNumbers)) {
      const key = `tel:${tel}`;
      telMap.set(key, [...(telMap.get(key) ?? []), contact.id]);
    }
    const nameKey = alnum(contact.fullName);
    const companyKey = canonicalCompanyKey(contact.company);
    if (nameKey && companyKey) {
      const key = `nc:${nameKey}|${companyKey}`;
      nameCompanyMap.set(key, [...(nameCompanyMap.get(key) ?? []), contact.id]);
    }
  }

  const unionAll = (ids: string[], evidence: string, strong: boolean) => {
    for (let i = 1; i < ids.length; i++) {
      uf.union(ids[0], ids[i]);
    }
    for (const id of ids) addEvidence(id, evidence, strong);
  };

  for (const ids of emailMap.values()) if (ids.length > 1) unionAll(ids, "shared email", true);
  for (const ids of mobileMap.values()) if (ids.length > 1) unionAll(ids, "shared mobile", true);
  for (const ids of nameCompanyMap.values()) {
    if (ids.length > 1) unionAll(ids, "same name + company", true);
  }

  // Landline: weak, and skipped entirely when it is a shared switchboard
  // (>= 3 distinct person names at the same canonical company).
  const byId = new Map(contacts.map((c) => [c.id, c]));
  for (const ids of telMap.values()) {
    if (ids.length <= 1) continue;
    const distinctNames = new Set(
      ids.map((id) => alnum(byId.get(id)?.fullName)).filter(Boolean),
    );
    const companyKeys = new Set(
      ids.map((id) => canonicalCompanyKey(byId.get(id)?.company ?? null)).filter(Boolean),
    );
    if (distinctNames.size >= 3 && companyKeys.size === 1) continue; // switchboard
    unionAll(ids, "shared landline", false);
  }

  const groups = new Map<string, string[]>();
  for (const contact of contacts) {
    const root = uf.find(contact.id);
    groups.set(root, [...(groups.get(root) ?? []), contact.id]);
  }

  const result: { ids: string[]; evidence: string[]; strong: boolean }[] = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const evidence = new Set<string>();
    for (const id of ids) for (const e of evidenceById.get(id) ?? []) evidence.add(e);
    result.push({ ids, evidence: [...evidence], strong: strongRoots.has(uf.find(ids[0])) });
  }
  return result;
}

function score(contact: Contact): number {
  return NON_NULL_FIELDS.filter((field) => {
    const value = contact[field as keyof Contact];
    return value !== null && value !== undefined && value !== "";
  }).length;
}

function pickSurvivor(contacts: Contact[]): Contact {
  return [...contacts].sort((a, b) => {
    const scoreDiff = score(b) - score(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

async function reportMode(contacts: Contact[]): Promise<void> {
  const groups = buildGroups(contacts);
  const byId = new Map(contacts.map((c) => [c.id, c]));

  const report = groups.map((group) => {
    const members = group.ids.map((id) => byId.get(id)!).filter(Boolean);
    const survivor = pickSurvivor(members);
    return {
      survivorId: survivor.id,
      confidence: group.strong ? "strong" : "weak",
      evidence: group.evidence,
      members: members.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        company: m.company,
        emails: m.emails,
        mobileNumbers: m.mobileNumbers,
        telephoneNumbers: m.telephoneNumbers,
      })),
    };
  });

  console.log(`Found ${report.length} duplicate groups (${groups.filter((g) => g.strong).length} strong).`);
  const summary =
    `Read-only dedupe scan. Groups: ${report.length}, strong: ${groups.filter((g) => g.strong).length}. ` +
    `Contacts in groups: ${groups.reduce((n, g) => n + g.ids.length, 0)}.`;
  console.log(summary);
  audit.logRun(summary);

  if (DRY_RUN) {
    console.log("Dry run - no report file written.");
    return;
  }
  const dir = runsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `dedupe-${runStamp()}.json`);
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), groups: report }, null, 2));
  console.log(`Report written to ${file}`);
}

async function mergeMode(file: string): Promise<void> {
  const approved = JSON.parse(fs.readFileSync(file, "utf8")) as
    | { groups: { ids: string[]; survivorId?: string }[] }
    | { ids: string[]; survivorId?: string }[];

  const groups = Array.isArray(approved) ? approved : approved.groups;
  console.log(`Merging ${groups.length} approved group(s).${DRY_RUN ? " (dry run)" : ""}`);

  let merged = 0;
  for (const group of groups) {
    const members = await prisma.contact.findMany({ where: { id: { in: group.ids } } });
    if (members.length < 2) continue;

    const survivor = group.survivorId
      ? members.find((m) => m.id === group.survivorId) ?? pickSurvivor(members)
      : pickSurvivor(members);
    const losers = members.filter((m) => m.id !== survivor.id);

    const data: Record<string, unknown> = {
      mobileNumbers: [...new Set([...survivor.mobileNumbers, ...losers.flatMap((l) => l.mobileNumbers)])],
      telephoneNumbers: [
        ...new Set([...survivor.telephoneNumbers, ...losers.flatMap((l) => l.telephoneNumbers)]),
      ].filter((t) => !survivor.mobileNumbers.includes(t)),
      emails: [...new Set([...survivor.emails, ...losers.flatMap((l) => l.emails)])],
    };

    for (const field of NON_NULL_FIELDS) {
      const current = survivor[field as keyof Contact];
      if (current === null || current === undefined || current === "") {
        const fill = losers
          .map((l) => l[field as keyof Contact])
          .find((v) => v !== null && v !== undefined && v !== "");
        if (fill !== undefined) data[field] = fill;
      }
    }
    if (!data.address) {
      const longest = [survivor, ...losers]
        .map((c) => c.address)
        .filter((a): a is string => !!a)
        .sort((a, b) => b.length - a.length)[0];
      if (longest) data.address = longest;
    }

    audit.record(survivor.id, "__merge__", { survivor: survivor.id }, { losers: losers.map((l) => l.id) });

    if (!DRY_RUN) {
      writeSnapshot(
        "dedupeContacts",
        members.map((m) => ({ ...m })),
      );
      await prisma.$transaction([
        prisma.contact.update({ where: { id: survivor.id }, data }),
        prisma.contact.deleteMany({ where: { id: { in: losers.map((l) => l.id) } } }),
      ]);
    }
    merged++;
    console.log(`Merged group ${merged}/${groups.length} into ${survivor.id}`);
  }

  const summary = `Merge run. Groups merged: ${merged}, applied: ${DRY_RUN ? 0 : merged}.`;
  console.log(summary);
  audit.logRun(summary);
}

async function main() {
  const contacts = await prisma.contact.findMany({ orderBy: { createdAt: "asc" } });
  if (MERGE_FILE) {
    await mergeMode(MERGE_FILE);
  } else {
    await reportMode(contacts);
  }
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
