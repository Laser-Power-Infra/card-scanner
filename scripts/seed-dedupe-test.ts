// scripts/seed-dedupe-test.ts
//
// Seeds 100 contacts for exercising the paginated directory and the dedupe
// backfill. Rows are inserted the way legacy data looks: no state, country or
// dedupeKey, all `active`. Run `pnpm backfill:dedupe` afterwards to derive
// those columns and mark duplicates inactive.
//
// Mix (deterministic):
//   70 unique contacts spread over Indian states and a few countries
//   10 email duplicates   (same first email, different case / other fields)
//    6 phone duplicates   (no email; same first mobile, different spacing / + / -)
//    6 name+company dups  (no email or phone, same name and company)
//    2 empty rows         (no email, phone, name or company: null key, stay active)
//   Expected after backfill: 22 inactive, 78 active.
//
// Tagged via rawNotes = "dedupe-seed"; re-running replaces the previous seed.
//
// Run: pnpm tsx scripts/seed-dedupe-test.ts [--clean]

import "dotenv/config";
import { prisma } from "../lib/prisma";

const TAG = "dedupe-seed";

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Sara", "Vikram", "Ananya", "Ishaan", "Nisha"];
const LAST = ["Sharma", "Iyer", "Reddy", "Patel", "Khan", "Das", "Gill", "Nair", "Mehta", "Bose"];
const COMPANIES = ["Kaveri Steel", "Deccan Automation", "Ganga Photonics", "Laser Power & Infra", "Sabarmati CNC", "Eastline Tools", "Malabar Marine"];
const TITLES = ["Purchase Manager", "Plant Head", "Sales Engineer", "Director", "QA Lead"];
const LOCATIONS = [
  "Mumbai, Maharashtra, India",
  "Pune, Maharashtra, India",
  "Bengaluru, Karnataka, India",
  "Chennai, Tamil Nadu, India",
  "Kolkata, West Bengal, India",
  "Hyderabad, Telangana, India",
  "Noida, Uttar Pradesh",
  "Gurugram, Haryana",
  "Ahmedabad, Gujarat, India",
  "Lyon, France",
  "Dubai, United Arab Emirates",
  null,
];

type Row = {
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
  emails: string[];
  mobileNumbers: string[];
  telephoneNumbers: string[];
  companyLocation: string | null;
  createdAt: Date;
};

const base = Date.now() - 100 * 3_600_000;
let tick = 0;
// Strictly increasing timestamps so "newest stays active" is predictable.
const nextDate = () => new Date(base + tick++ * 3_600_000);

function unique(i: number): Row {
  const first = FIRST[i % FIRST.length];
  const last = LAST[Math.floor(i / FIRST.length) % LAST.length];
  const company = COMPANIES[i % COMPANIES.length];
  return {
    fullName: `${first} ${last}`,
    jobTitle: TITLES[i % TITLES.length],
    company,
    emails: i % 9 === 0 ? [] : [`${first}.${last}${i}@example.com`.toLowerCase()],
    mobileNumbers: i % 4 === 0 ? [] : [`+9198${String(10000000 + i * 7919).slice(0, 8)}`],
    telephoneNumbers: [],
    companyLocation: LOCATIONS[i % LOCATIONS.length],
    createdAt: nextDate(),
  };
}

async function main() {
  const removed = await prisma.contact.deleteMany({ where: { rawNotes: TAG } });
  if (removed.count) console.log(`Removed ${removed.count} previous seed rows.`);
  if (process.argv.includes("--clean")) return;

  const rows: Row[] = [];
  for (let i = 0; i < 70; i++) rows.push(unique(i));

  // Email duplicates: same first email in a different case, newer row.
  const withEmail = rows.filter((r) => r.emails.length).slice(0, 10);
  for (const r of withEmail) {
    rows.push({ ...r, emails: [r.emails[0].toUpperCase()], jobTitle: "Updated title", createdAt: nextDate() });
  }

  // Phone duplicates: rows with no email, same mobile written with spaces/dashes.
  const phoneOnly = rows.filter((r) => !r.emails.length && r.mobileNumbers.length).slice(0, 6);
  for (const r of phoneOnly) {
    const m = r.mobileNumbers[0];
    rows.push({ ...r, mobileNumbers: [`${m.slice(0, 3)} ${m.slice(3, 8)}-${m.slice(8)}`], createdAt: nextDate() });
  }

  // Name+company duplicates: no email or phone on either side.
  for (let i = 0; i < 6; i++) {
    const r: Row = {
      fullName: `Walk-in ${FIRST[i]}`,
      jobTitle: null,
      company: COMPANIES[i],
      emails: [],
      mobileNumbers: [],
      telephoneNumbers: [],
      companyLocation: LOCATIONS[i],
      createdAt: nextDate(),
    };
    rows.push(r, { ...r, fullName: r.fullName!.toUpperCase(), createdAt: nextDate() });
  }

  // Empty rows: null dedupeKey, must all stay active.
  while (rows.length < 100) {
    rows.push({ fullName: null, jobTitle: null, company: null, emails: [], mobileNumbers: [], telephoneNumbers: [], companyLocation: null, createdAt: nextDate() });
  }

  const created = await prisma.contact.createManyAndReturn({
    data: rows.map((r) => ({ ...r, rawNotes: TAG })),
    select: { id: true },
  });

  // A third of the unique contacts get a finished enrichment, so the Profile facet has both values.
  await prisma.enrichment.createMany({
    data: created.filter((_, i) => i < 70 && i % 3 === 0).map((c) => ({ contact_id: c.id, status: "DONE" as const })),
  });

  console.log(`Seeded ${created.length} contacts (expected after backfill: 78 active, 22 inactive).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    prisma.$disconnect();
  });
