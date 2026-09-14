import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { catalog, type Entry, type Model } from "./catalog";
import { readCsv } from "./csv/read";
import { normalize, SYNTHETIC_DATASET, type RecordData } from "./normalizers/record";
import { dictionary } from "./schemas/records";

export interface IngestionStore {
  upsert(entry: Entry, data: RecordData): Promise<void>;
  count(entry: Entry, organizationIds: string[]): Promise<number>;
}
export type Issue = { file: string; row: number; kind: "csv" | "validation" | "relationship" | "database"; message: string; organizationId?: string };
export type TableReport = { model: Model; file: string; csvRows: number; expectedRows: number; imported: number; rejected: number; databaseRows: number; matches: boolean };
export type ImportReport = { dataset: string; startedAt: string; tables: TableReport[]; issues: Issue[]; organizationIds: string[]; ok: boolean };
export class RecordImportError extends Error {}
const keyFor = (organizationId: unknown, id: unknown) => JSON.stringify([organizationId, id]);

export async function ingestSynthetic(store: IngestionStore, directory: string): Promise<ImportReport> {
  const now = new Date();
  const report: ImportReport = { dataset: SYNTHETIC_DATASET, startedAt: now.toISOString(), tables: [], issues: [], organizationIds: [], ok: false };
  const accepted = new Map<Model, Map<string, RecordData>>();
  async function load(file: string, headers: string[]) {
    try {
      const parsed = readCsv(await readFile(join(directory, file), "utf8"), headers);
      report.issues.push(...parsed.errors.map((error) => ({ file, ...error, kind: "csv" as const })));
      return parsed.rows;
    } catch (error) {
      report.issues.push({ file, row: 1, kind: "csv", message: `Unable to read file (${(error as NodeJS.ErrnoException).code ?? "unknown"})` });
      return [];
    }
  }
  // Validate the dictionary as a reference artifact; no analytics table is needed.
  const dictionaryRows = await load("data_dictionary.csv", Object.keys(dictionary.shape));
  const dictionaryFiles = new Set<string>();
  for (const row of dictionaryRows) {
    const result = dictionary.safeParse(row.data);
    if (row.error || !result.success) report.issues.push({ file: "data_dictionary.csv", row: row.row, kind: "validation", message: row.error ?? "Invalid dictionary row" });
    else if (!catalog.some((entry) => entry.file === result.data.file) || dictionaryFiles.has(result.data.file)) report.issues.push({ file: "data_dictionary.csv", row: row.row, kind: "validation", message: "Unknown or duplicate dictionary file" });
    else dictionaryFiles.add(result.data.file);
  }
  if (dictionaryFiles.size !== catalog.length) report.issues.push({ file: "data_dictionary.csv", row: 1, kind: "validation", message: "Dictionary must describe every import file exactly once" });

  for (const entry of catalog) {
    const rows = await load(entry.file, Object.keys(entry.schema.shape));
    const table: TableReport = { model: entry.model, file: entry.file, csvRows: rows.length, expectedRows: rows.length * (entry.model === "MetricDefinition" ? report.organizationIds.length : 1), imported: 0, rejected: 0, databaseRows: 0, matches: false };
    report.tables.push(table);
    const records = new Map<string, RecordData>();
    accepted.set(entry.model, records);
    const seenSources = new Set<string>();
    const seenBusiness = new Set<string>();
    const seenGrains = new Set<string>();
    for (const row of rows) {
      const result = entry.schema.safeParse(row.data);
      if (row.error || !result.success) {
        table.rejected += entry.model === "MetricDefinition" ? report.organizationIds.length : 1;
        report.issues.push({ file: entry.file, row: row.row, kind: "validation", message: row.error ?? (!result.success ? result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "Invalid row") });
        continue;
      }
      // Global catalog definitions belong only to successfully imported organizations.
      const tenants = entry.model === "MetricDefinition" ? report.organizationIds : [undefined];
      for (const tenant of tenants) {
        const data = normalize(entry.model, result.data, now, tenant);
        const org = String(entry.model === "Organization" ? data.id : data.organizationId);
        const businessKey = keyFor(org, entry.model === "MetricDefinition" ? [data.key, data.version] : data[entry.key]);
        const sourceKey = keyFor(org, [data.sourceSystem, data.sourceRecordId]);
        let problem: string | undefined;
        if (seenSources.has(sourceKey) || seenBusiness.has(businessKey)) problem = "Duplicate source or business identifier in CSV";
        seenSources.add(sourceKey); seenBusiness.add(businessKey);
        if (entry.model === "GA4DailyMetric") {
          const grain = keyFor(org, [data.sourceSystem, data.date, data.channel]);
          if (seenGrains.has(grain)) problem = "Duplicate daily channel grain in CSV";
          seenGrains.add(grain);
        }
        if (entry.model !== "Organization" && !report.organizationIds.includes(org)) problem = "Organization was not successfully imported from organizations.csv";
        for (const parent of entry.parents) {
          const related = accepted.get(parent.model)?.get(keyFor(org, data[parent.field]));
          if (!related) problem = `Missing same-organization ${parent.model}.${parent.field}: ${String(data[parent.field])}`;
          else if (entry.model === "StripePayment" && parent.model === "StripeSubscription" && related.customerId !== data.customerId) problem = "Subscription belongs to a different customer";
        }
        if (problem) {
          table.rejected++;
          report.issues.push({ file: entry.file, row: row.row, organizationId: org, kind: "relationship", message: problem });
          continue;
        }
        try {
          await store.upsert(entry, data);
          table.imported++;
          records.set(businessKey, data);
          if (entry.model === "Organization") report.organizationIds.push(org);
        } catch (error) {
          // Only recover known per-record constraint failures. Connectivity, schema,
          // timeout and programming failures must fail the command, never appear successful.
          if (!(error instanceof RecordImportError)) throw error;
          table.rejected++;
          report.issues.push({ file: entry.file, row: row.row, organizationId: org, kind: "database", message: error.message });
        }
      }
    }
    table.databaseRows = await store.count(entry, report.organizationIds);
    table.matches = table.databaseRows === table.expectedRows && table.imported === table.expectedRows && table.rejected === 0 && !report.issues.some((issue) => issue.file === entry.file);
  }
  report.ok = report.organizationIds.length > 0 && report.issues.length === 0 && report.tables.every((table) => table.matches);
  return report;
}
