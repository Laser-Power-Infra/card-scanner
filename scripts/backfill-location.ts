// @ts-nocheck

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ScriptAudit } from "../lib/scriptAudit";
import indiaStates from "../data/india.json";

const INDIAN_STATES: Record<string, string[]> = indiaStates;

const DRY_RUN = process.argv.includes("--dry-run");
const audit = new ScriptAudit("backfill-location", DRY_RUN);

function extractState(address: string | null): { state: string | null; issue: string | null } {
    if (!address) return { state: null, issue: "no_address" };

    const normalized = address.toLowerCase().replace(/[.,]/g, " ");
    const matches = new Set<string>();

    for (const [canonical, variants] of Object.entries(INDIAN_STATES)) {
        for (const variant of variants) {
            // \b word boundaries stop "AP" matching inside "Apex" or "MP" inside "Compound"
            const re = new RegExp(`\\b${variant.toLowerCase()}\\b`);
            if (re.test(normalized)) {
                matches.add(canonical);
                break;
            }
        }
    }

    if (matches.size === 1) return { state: [...matches][0], issue: null };
    if (matches.size > 1) return { state: null, issue: "multiple_matches" };
    return { state: null, issue: "no_match" };
}

async function main() {
    const contacts = await prisma.contact.findMany({
        where: { address: { not: null } }, // adjust field name if different
        select: { id: true, address: true, companyLocation:true },
    });

    console.log(`Processing ${contacts.length} rows...${DRY_RUN ? " (dry run)" : ""}`);

    let updated = 0;
    let flagged = 0;
    const issues: { id: string; address: string; issue: string }[] = [];

    for (const c of contacts) {
        const { state, issue } = extractState(c.address);

        if (state) {
            audit.record(c.id, "companyLocation", c.companyLocation, state);
            if (!DRY_RUN) {
                await prisma.contact.update({
                    where: { id: c.id },
                    data: { companyLocation: state },
                });
            }
            updated++;
        } else {
            flagged++;
            issues.push({ id: c.id, address: c.address ?? "", issue: issue ?? "unknown" });
        }
    }

    console.log(`Updated: ${updated}, flagged for review: ${flagged}`);

    if (issues.length > 0) {
        require("fs").writeFileSync(
            "location-issues.json",
            JSON.stringify(issues, null, 2)
        );
        console.log(`Flagged rows written to location-issues.json`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => { audit.write(); prisma.$disconnect(); });