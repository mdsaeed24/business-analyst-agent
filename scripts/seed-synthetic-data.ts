import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ingestSynthetic } from "../src/lib/ingestion/pipeline";
import { assertDevelopment, prismaStore, withSyntheticTransaction } from "../src/lib/ingestion/prisma-store";
import { createIngestionClient, failure } from "./ingestion-runtime";

async function main() {
  const db = createIngestionClient();
  try {
    assertDevelopment(process.env.NODE_ENV);
    const report = await withSyntheticTransaction(db, (tx) => ingestSynthetic(prismaStore(tx), resolve("data/synthetic")));
    await mkdir("reports", { recursive: true });
    const reportPath = resolve("reports/synthetic-ingestion.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.table(report.tables.map(({ model, csvRows, expectedRows, imported, rejected, databaseRows, matches }) => ({ model, csvRows, expectedRows, imported, rejected, databaseRows, matches })));
    console.log(`Validation issues: ${report.issues.length}. Report: ${reportPath}`);
    if (!report.ok) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
main().catch(failure);
