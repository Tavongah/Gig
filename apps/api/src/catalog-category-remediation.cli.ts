import { prisma } from "./config/prisma.js";
import {
  applyCatalogCategoryRemediation,
  planCatalogCategoryRemediation,
  type RemediationDecision
} from "./modules/commerce/catalog-category-remediation.js";

function parseMode(argv: string[]) {
  const unknown = argv.filter((arg) => arg !== "--dry-run" && arg !== "--apply");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(" ")}. Use --dry-run (default) or --apply.`);
  }
  if (argv.includes("--apply") && argv.includes("--dry-run")) {
    throw new Error("Pass either --dry-run or --apply, not both.");
  }
  return { apply: argv.includes("--apply") };
}

function publicDecision(row: RemediationDecision) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    currentCategory: row.currentCategory,
    suggestedCategory: row.suggestedCategory,
    confidence: row.confidence,
    evidence: row.evidence,
    action: row.action,
    reason: row.reason
  };
}

export async function runCatalogCategoryRemediationCli(argv = process.argv.slice(2)) {
  const mode = parseMode(argv);
  const result = await applyCatalogCategoryRemediation(prisma, mode);
  const post = mode.apply ? await planCatalogCategoryRemediation(prisma) : null;

  const payload = {
    ok: true,
    apply: result.apply,
    writes: result.writes,
    preApply: {
      summary: result.summary,
      archivedSkipped: result.archived,
      proposed: result.proposed.map(publicDecision),
      skippedHigh: result.skippedHigh.map(publicDecision),
      mediumMismatches: result.mediumMismatches
    },
    applied: result.applied,
    postApply: post
      ? {
          summary: post.summary,
          archivedSkipped: post.archived,
          highMismatchesRemaining: post.highMismatches.map(publicDecision),
          mediumRemaining: post.mediumMismatches
        }
      : null
  };

  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

const invokedDirectly = /catalog-category-remediation\.cli/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  runCatalogCategoryRemediationCli()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
