import { prisma } from "@/lib/prisma";

async function main() {
  console.log("Starting dedupe run (no destructive actions taken automatically)");

  // This script finds potential duplicates by email or primary phone and reports them.
  const contacts = await prisma.contact.findMany({ orderBy: { createdAt: "asc" } });

  const seen = new Map<string, string>();
  const duplicates: { id: string; keepId: string; reason: string }[] = [];

  for (const c of contacts) {
    const email = (c.emails && c.emails[0]) || null;
    const mobile = (c.mobileNumbers && c.mobileNumbers[0]) || null;
    const tel = (c.telephoneNumbers && c.telephoneNumbers[0]) || null;

    const key = email ? `email:${email}` : mobile ? `mobile:${mobile}` : tel ? `tel:${tel}` : `namecomp:${(c.fullName||"")}|${(c.company||"")}`;

    if (seen.has(key)) {
      duplicates.push({ id: c.id, keepId: seen.get(key)!, reason: key });
    } else {
      seen.set(key, c.id);
    }
  }

  console.log(`Found ${duplicates.length} potential duplicates.`);
  for (const d of duplicates) {
    console.log(`Duplicate: ${d.id} (keep ${d.keepId}) reason=${d.reason}`);
  }

  console.log("Review the above list and run a cleanup command manually if desired.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
