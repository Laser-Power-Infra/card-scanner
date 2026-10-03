import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ScriptAudit } from "../lib/scriptAudit";

const DRY_RUN = process.argv.includes("--dry-run");
const audit = new ScriptAudit("post-migration-checks", DRY_RUN);

async function main() {
  console.log(`Starting post-migration checks${DRY_RUN ? " (dry run)" : ""}`);

  // 1. ANALYZE — refresh planner statistics after index creation.
  console.log("\n[1/4] Running ANALYZE...");
  await prisma.$executeRaw`ANALYZE "Contact"`;
  await prisma.$executeRaw`ANALYZE "enrichment"`;
  await prisma.$executeRaw`ANALYZE "LocationCache"`;
  console.log("ANALYZE complete.");

  // 2. Index usage check — verify GIN indexes are being used.
  console.log("\n[2/4] Index usage report:");
  const indexStats = await prisma.$queryRaw<
    {
      relname: string;
      indexrelname: string;
      idx_scan: bigint;
      idx_tup_read: bigint;
    }[]
  >`SELECT relname, indexrelname, idx_scan, idx_tup_read
     FROM pg_stat_user_indexes
     WHERE relname IN ('Contact', 'enrichment')
     ORDER BY idx_scan ASC`;

  for (const row of indexStats) {
    console.log(
      `  ${row.relname}.${row.indexrelname}: scans=${row.idx_scan} tup_read=${row.idx_tup_read}`
    );
  }

  const unused = indexStats.filter((r) => r.idx_scan === BigInt(0));
  if (unused.length > 0) {
    console.log(`\n  WARNING: ${unused.length} index(es) have zero scans.`);
    console.log("  If this persists after normal traffic, consider dropping them:");
    for (const u of unused) {
      console.log(`    DROP INDEX IF EXISTS "${u.indexrelname}";`);
    }
  } else {
    console.log("  All indexes have been used.");
  }

  // 3. LocationCache prune — resolved=false rows are never useful cache hits.
  console.log("\n[3/4] LocationCache prune:");
  const totalRows = await prisma.locationCache.count();
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const staleCount = await prisma.locationCache.count({
    where: { resolved: false, updatedAt: { lt: cutoff } },
  });
  console.log(`  LocationCache total rows: ${totalRows}`);
  console.log(`  Stale unresolved rows (resolved=false, older than 90d): ${staleCount}`);

  if (totalRows < 10000) {
    console.log("  Skipped — table below 10000 row threshold.");
  } else if (staleCount === 0) {
    console.log("  Nothing to prune.");
  } else if (DRY_RUN) {
    console.log(`  Dry run — would delete ${staleCount} rows.`);
  } else {
    const deleted = await prisma.locationCache.deleteMany({
      where: { resolved: false, updatedAt: { lt: cutoff } },
    });
    console.log(`  Pruned ${deleted.count} stale unresolved rows.`);
  }

  // 4. Dead tuple check.
  console.log("\n[4/4] Dead tuple report:");
  const deadTuples = await prisma.$queryRaw<
    {
      relname: string;
      n_live_tup: bigint;
      n_dead_tup: bigint;
    }[]
  >`SELECT relname, n_live_tup, n_dead_tup
     FROM pg_stat_user_tables
     WHERE relname IN ('Contact', 'enrichment', 'LocationCache')
     ORDER BY n_dead_tup DESC`;

  for (const row of deadTuples) {
    const deadPct =
      row.n_live_tup > 0
        ? ((Number(row.n_dead_tup) / Number(row.n_live_tup)) * 100).toFixed(2)
        : "0.00";
    console.log(
      `  ${row.relname}: live=${row.n_live_tup} dead=${row.n_dead_tup} (${deadPct}%)`
    );
  }

  const highDead = deadTuples.filter(
    (r) => r.n_live_tup > 0 && Number(r.n_dead_tup) / Number(r.n_live_tup) > 0.2
  );
  if (highDead.length > 0) {
    console.log("\n  WARNING: >20% dead tuples on:");
    for (const t of highDead) {
      console.log(`    VACUUM ANALYZE "${t.relname}";`);
    }
  } else {
    console.log("  All tables healthy.");
  }

  const summary =
    `Post-migration checks. ANALYZE on Contact/enrichment/LocationCache. ` +
    `${indexStats.length} indexes checked, ${unused.length} unused. ` +
    `LocationCache: ${totalRows} rows, ${staleCount} stale unresolved. ` +
    `${highDead.length} tables with >20% dead tuples.`;
  console.log(`\n${summary}`);
  audit.logRun(summary);
  audit.write();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
