/**
 * clean-dev-db.mjs — Phase 10.1 dev database cleanup.
 *
 * Removes duplicate test-fixture strategies that were written to the
 * development database when the test suite ran against a real Postgres
 * instance instead of an isolated test DB.
 *
 * SAFE GUARDS:
 *   - Only runs in development (OLYR_ENV=development or unset).
 *   - Never deletes the newest copy of any strategy name — keeps one.
 *   - Never touches strategies that have linked Execution records.
 *   - Dry-run by default; pass --apply to actually delete.
 *   - Never logs credential values.
 *
 * Usage:
 *   node scripts/clean-dev-db.mjs            # dry-run
 *   node scripts/clean-dev-db.mjs --apply    # delete duplicates
 */

import { PrismaClient } from "@prisma/client";

const DRY_RUN = !process.argv.includes("--apply");
const env = process.env.OLYR_ENV ?? "development";

if (env === "production") {
  console.error("ERROR: This script refuses to run in production (OLYR_ENV=production).");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (pass --apply to delete)" : "APPLY"}`);
  console.log(`Environment: ${env}\n`);

  // Group strategies by (ownerId, name) to find duplicates.
  const all = await prisma.strategy.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      ownerId: true,
      status: true,
      createdAt: true,
      _count: { select: { proposals: true } },
    },
  });

  /** @type {Map<string, typeof all>} */
  const byKey = new Map();
  for (const row of all) {
    const key = `${row.ownerId}::${row.name}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }

  const toDelete = [];
  for (const [key, rows] of byKey) {
    if (rows.length <= 1) continue;
    // Keep the newest (first, already sorted desc). Delete the rest.
    const [keep, ...dupes] = rows;
    console.log(`\nDuplicate: "${key}"`);
    console.log(`  Keep  : id=${keep.id} createdAt=${keep.createdAt.toISOString()} status=${keep.status}`);
    for (const dupe of dupes) {
      // Never delete a strategy that has linked executions.
      const hasExecutions = await prisma.execution.count({
        where: { proposal: { strategyId: dupe.id } },
      });
      if (hasExecutions > 0) {
        console.log(
          `  SKIP  : id=${dupe.id} — has ${hasExecutions} linked execution(s), not deleting.`,
        );
        continue;
      }
      console.log(
        `  Delete: id=${dupe.id} createdAt=${dupe.createdAt.toISOString()} status=${dupe.status} proposals=${dupe._count.proposals}`,
      );
      toDelete.push(dupe.id);
    }
  }

  if (toDelete.length === 0) {
    console.log("\nNo duplicates found — database is already clean.");
    return;
  }

  console.log(`\nTotal to delete: ${toDelete.length} strategies`);
  if (DRY_RUN) {
    console.log("Dry-run complete. No changes made. Re-run with --apply to delete.");
    return;
  }

  // Cascading delete: AgentEvent and TradeProposal cascade from Strategy.
  const result = await prisma.strategy.deleteMany({ where: { id: { in: toDelete } } });
  console.log(`\nDeleted ${result.count} duplicate strategy records.`);
}

main()
  .catch((e) => {
    console.error("Script failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
