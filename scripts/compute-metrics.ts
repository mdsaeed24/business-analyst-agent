import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { createIngestionClient } from "./ingestion-runtime";
import { computeMetrics } from "../src/lib/metrics/service";
import { requestSchema } from "../src/lib/metrics/period";
async function main() {
  const { values } = parseArgs({ options: { org: { type: "string" }, from: { type: "string" }, to: { type: "string" } } });
  const input = requestSchema.parse({ organizationId: values.org, from: values.from, to: values.to });
  const db = createIngestionClient();
  try {
    const report = await computeMetrics(db, input);
    await mkdir("reports", { recursive: true });
    await writeFile("reports/metrics.json", JSON.stringify(report, null, 2) + "\n");
    console.table(report.results.map(({ key, value, status, unit, sourceCount }) => ({ key, value, status, unit, sourceCount })));
    console.log("Saved reports/metrics.json; full source evidence is stored in MetricValue.calculationDetails.");
  } finally { await db.$disconnect(); }
}
main().catch(() => {
  console.error("Metric computation failed. Check database configuration, seeded definitions, and arguments: --org ORGANIZATION_ID --from YYYY-MM-DD --to YYYY-MM-DD (exclusive). No partial metric batch is committed.");
  process.exitCode = 1;
});
