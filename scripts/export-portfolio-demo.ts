import { mkdir, writeFile } from "node:fs/promises";
import { createIngestionClient, failure } from "./ingestion-runtime";
import { SYNTHETIC_DATASET } from "../src/lib/ingestion/normalizers/record";
import { metricCatalog, type MetricKey } from "../src/lib/metrics/catalog";
import { analyze, snapshotSchema, validateSnapshot, type SavedMetric } from "../src/lib/investigations/analyze";

// Read-only export. Publish aggregate snapshots only, never identities, sessions,
// credentials, live records, raw source rows, or user-authored explanations.
async function main() {
  const db = createIngestionClient();
  try {
    const organizations = await db.organization.findMany({ where: { syntheticDataset: SYNTHETIC_DATASET }, select: { id: true, name: true, timezone: true }, orderBy: { id: "asc" } });
    const output = [];
    for (const org of organizations) {
      const rows = await db.metricValue.findMany({ where: { organizationId: org.id, syntheticDataset: SYNTHETIC_DATASET, metricDefinition: { version: "1.0", syntheticDataset: SYNTHETIC_DATASET } }, include: { metricDefinition: { select: { name: true, key: true } } } });
      const metrics = [];
      const input = { organizationId: org.id, from: "2026-08-01", to: "2026-09-01", compareFrom: "2026-07-01", compareTo: "2026-08-01" };
      for (const key of Object.keys(metricCatalog) as MetricKey[]) {
        function find(from: string, to: string): SavedMetric | null {
          for (const row of rows.filter((r) => r.metricDefinition.key === key)) {
            const parsed = snapshotSchema.safeParse(row.calculationDetails);
            if (!parsed.success || parsed.data.from !== from || parsed.data.toExclusive !== to) continue;
            const saved = { id: row.id, value: row.value?.toString() ?? null, status: row.status, inputHash: row.inputHash, snapshot: parsed.data };
            validateSnapshot(key, saved, org.id, from, to);
            return saved;
          }
          return null;
        }
        const current = find(input.from, input.to), baseline = find(input.compareFrom, input.compareTo);
        if (!current || !baseline) continue;
        const finding = analyze(key, current, baseline, input);
        const project = (r: SavedMetric) => ({ value: r.value, status: r.status, sourceCount: r.snapshot.sourceCount, numerator: r.snapshot.numerator, denominator: r.snapshot.denominator, limitations: r.snapshot.limitations, inputHash: r.inputHash });
        metrics.push({ key, name: rows.find((r) => r.metricDefinition.key === key)!.metricDefinition.name, unit: metricCatalog[key].unit, formula: metricCatalog[key].formula, current: project(current), baseline: project(baseline), finding: { state: finding.state, statement: finding.statement, nextStep: finding.nextStep, significant: finding.significant, delta: finding.delta, relativePercent: finding.relativePercent } });
      }
      if (metrics.length === 8) output.push({ name: org.name, timezone: org.timezone, metrics });
    }
    if (!output.length) throw new Error("No complete validated synthetic July/August snapshots; seed and compute demo metrics first");
    await mkdir("showcase", { recursive: true });
    await writeFile("showcase/snapshot.json", JSON.stringify({ demo: true, engineVersion: "1.0.0", current: "August 2026", baseline: "July 2026", organizations: output }, null, 2) + "\n");
    console.log(`Exported ${output.length} synthetic organizations with 8 validated metric comparisons each. No raw records exported.`);
  } finally { await db.$disconnect(); }
}
main().catch(failure);
