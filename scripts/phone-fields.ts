// scripts/fix-phone-fields.ts
import "dotenv/config";
import { prisma } from "../lib/prisma";
const DRY_RUN = process.argv.includes("--dry-run");

// Indian STD codes always start with 0 after stripping country code.
// Indian mobiles are always 10 digits starting with 6-9.
// So this split is unambiguous for Indian numbers, and safely leaves
// non-Indian numbers (e.g. "03-3724-7201") untouched since they won't
// match the 6-9 + 10-digit mobile pattern either.
function stripToLocalDigits(raw: string): string {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("0091")) digits = digits.slice(4);
    else if (digits.startsWith("91") && digits.length > 10) digits = digits.slice(2);
    return digits;
}

function isMobile(raw: string): boolean {
    const digits = stripToLocalDigits(raw);
    return /^[6-9]\d{9}$/.test(digits);
}

function normalizeMobile(raw: string): string {
    const digits = stripToLocalDigits(raw);
    return `+91${digits}`;
}

function extractNumbers(field: string[] | string | null | undefined): string[] {
    if (!field) return [];
    const list = Array.isArray(field) ? field : [field];
    return list
        .flatMap((s) => s.split(","))
        .map((s) => s.trim())
        .filter(Boolean);
}

async function main() {
    const contacts = await prisma.contact.findMany({
        where: { telephoneNumbers: { isEmpty: false } },
        select: { id: true, telephoneNumbers: true, mobileNumbers: true },
    });

    console.log(`Checking ${contacts.length} rows...${DRY_RUN ? " (dry run)" : ""}`);

    let moved = 0;
    const report: { id: string; movedNumbers: string[] }[] = [];

    for (const c of contacts) {
        const telEntries = extractNumbers(c.telephoneNumbers);
        const stillTel: string[] = [];
        const foundMobiles: string[] = [];

        for (const entry of telEntries) {
            if (isMobile(entry)) foundMobiles.push(normalizeMobile(entry));
            else stillTel.push(entry);
        }

        if (foundMobiles.length === 0) continue;

        const existingMobiles = extractNumbers(c.mobileNumbers);
        const mergedMobiles = [...new Set([...existingMobiles, ...foundMobiles])];

        moved++;
        report.push({ id: c.id, movedNumbers: foundMobiles });

        if (!DRY_RUN) {
            await prisma.contact.update({
                where: { id: c.id },
                data: {
                    telephoneNumbers: stillTel,
                    mobileNumbers: mergedMobiles,
                },
            });
        }
    }

    console.log(`Rows fixed: ${moved}`);
    if (report.length) {
        require("fs").writeFileSync("phone-fixes.json", JSON.stringify(report, null, 2));
        console.log("Details written to phone-fixes.json");
    }
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
