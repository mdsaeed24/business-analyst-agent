import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { catalog, type Entry } from "../src/lib/ingestion/catalog";
import { readCsv } from "../src/lib/ingestion/csv/read";
import { normalize, type RecordData } from "../src/lib/ingestion/normalizers/record";
import { ingestSynthetic, RecordImportError, type IngestionStore } from "../src/lib/ingestion/pipeline";
import { assertDevelopment, identity } from "../src/lib/ingestion/prisma-store";
import { boolean, date, integer, money, rate } from "../src/lib/ingestion/schemas/primitives";

class MemoryStore implements IngestionStore {
  tables = new Map<string, Map<string, RecordData>>();
  async upsert(entry: Entry, data: RecordData) {
    const table = this.tables.get(entry.model) ?? new Map<string, RecordData>();
    table.set(JSON.stringify(identity(entry, data)), data);
    this.tables.set(entry.model, table);
  }
  async count(entry: Entry, ids: string[]) {
    return [...(this.tables.get(entry.model)?.values() ?? [])].filter((r) => ids.includes(String(entry.model === "Organization" ? r.id : r.organizationId))).length;
  }
}
const directory = resolve("data/synthetic");
async function fixture(work: (path: string) => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), "ba-ingestion-"));
  try {
    for (const entry of catalog) {
      const content = await readFile(join(directory, entry.file), "utf8");
      // Retain full files, so relationship failures exercise the real dependency map.
      await writeFile(join(path, entry.file), content);
    }
    await writeFile(join(path, "data_dictionary.csv"), await readFile(join(directory, "data_dictionary.csv")));
    await work(path);
  } finally { await rm(path, { recursive: true, force: true }); }
}

describe("CSV parsing and deterministic validation", () => {
  it("handles BOM, CRLF, commas, escaped quotes and multiline fields", () => {
    expect(readCsv('\uFEFFid,name\r\n1,"A, ""B""\nC"\r\n', ["id", "name"]).rows).toEqual([{ row: 3, data: { id: "1", name: 'A, "B"\nC' } }]);
  });
  it("rejects missing, duplicate and unknown headers", () => {
    for (const csv of ["id,id\n1,2", "id\n1", "id,bogus\n1,2", ""]) expect(readCsv(csv, ["id", "name"]).errors[0].row).toBe(1);
  });
  it("recovers column errors and reports unrecoverable quoting", () => {
    const parsed = readCsv("id,name\n1,A,extra\n2,B\n", ["id", "name"]);
    expect(parsed.rows[0]).toMatchObject({ row: 2, error: "Expected 2 columns, received 3" });
    expect(parsed.rows[1].error).toBeUndefined();
    expect(readCsv('id,name\n1,"broken', ["id", "name"]).errors[0]).toMatchObject({ row: 2 });
  });
  it("never coerces blank numbers or false strings incorrectly, and preserves decimal precision", () => {
    expect(boolean.parse("false")).toBe(false);
    expect(money.parse("999999999999999999.99")).toBe("999999999999999999.99");
    for (const value of ["", "1e3", "NaN", "-1", "0x10", "1.001"]) expect(money.safeParse(value).success).toBe(false);
    expect(integer.safeParse("2147483648").success).toBe(false);
    expect(rate.safeParse("1.0001").success).toBe(false);
    expect(date.safeParse("2025-02-30").success).toBe(false);
    expect(date.parse("2024-02-29").toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });
  it("validates every actual source row and remains idempotent", async () => {
    const store = new MemoryStore();
    const first = await ingestSynthetic(store, directory);
    expect(first.issues).toEqual([]);
    expect(first.ok).toBe(true);
    const second = await ingestSynthetic(store, directory);
    expect(second.tables).toEqual(first.tables);
    expect(second.tables.map((r) => r.databaseRows)).toEqual([1, 300, 1500, 908, 465, 465, 4914, 3648, 4786, 1300, 2341, 8]);
  }, 30000);
  it("reports malformed rows with filename/line and continues importing", async () => {
    await fixture(async (path) => {
      const file = join(path, "crm_companies.csv");
      const content = await readFile(file, "utf8");
      await writeFile(file, content.replace("3964418.26", "not-money"));
      const report = await ingestSynthetic(new MemoryStore(), path);
      expect(report.ok).toBe(false);
      expect(report.issues).toContainEqual(expect.objectContaining({ file: "crm_companies.csv", row: 2, kind: "validation" }));
      expect(report.tables.find((t) => t.model === "CRMCompany")?.imported).toBe(299);
      expect(report.issues.some((i) => i.kind === "relationship")).toBe(true);
      expect(report.tables.at(-1)?.imported).toBe(8);
    });
  }, 30000);
  it("rejects cross-tenant parents and mismatched payment customers", async () => {
    await fixture(async (path) => {
      const companies = join(path, "crm_companies.csv");
      await writeFile(companies, (await readFile(companies, "utf8")).replace("org_northstar_001", "org_other"));
      const payments = join(path, "stripe_payments.csv");
      await writeFile(payments, (await readFile(payments, "utf8")).replace("cus_00001,sub_00001", "cus_00002,sub_00001"));
      const report = await ingestSynthetic(new MemoryStore(), path);
      expect(report.issues).toContainEqual(expect.objectContaining({ file: "crm_companies.csv", row: 2, message: "Organization was not successfully imported from organizations.csv" }));
      expect(report.issues).toContainEqual(expect.objectContaining({ file: "stripe_payments.csv", row: 2, message: "Subscription belongs to a different customer" }));
    });
  }, 30000);
  it("recovers known row failures but propagates database outages", async () => {
    const store = new MemoryStore();
    const original = store.upsert.bind(store);
    store.upsert = async (entry, data) => {
      if (entry.model === "CRMContact" && data.contactId === "con_00001") throw new RecordImportError("Constraint failure");
      return original(entry, data);
    };
    const report = await ingestSynthetic(store, directory);
    expect(report.issues).toContainEqual(expect.objectContaining({ file: "crm_contacts.csv", row: 2, kind: "database" }));
    store.upsert = async () => { throw new Error("Database disconnected"); };
    await expect(ingestSynthetic(store, directory)).rejects.toThrow("Database disconnected");
  }, 30000);
  it("preserves tenant identity and leaves missing source timestamps null", () => {
    const data = normalize("MetricDefinition", { metric_key: "mrr", metric_name: "MRR", version: "1.0" }, new Date(), "org_a");
    expect(data).toMatchObject({ organizationId: "org_a", key: "mrr", sourceUpdatedAt: null });
    expect(identity(catalog[1], { organizationId: "a", sourceSystem: "hubspot", sourceRecordId: "same" })).not.toEqual(identity(catalog[1], { organizationId: "b", sourceSystem: "hubspot", sourceRecordId: "same" }));
  });
  it("reports duplicate CSV identities without silently claiming reconciliation", async () => {
    await fixture(async (path) => {
      const file = join(path, "quickbooks_expenses.csv");
      const content = await readFile(file, "utf8");
      await writeFile(file, content + content.split(/\r?\n/)[1] + "\n");
      const report = await ingestSynthetic(new MemoryStore(), path);
      expect(report.ok).toBe(false);
      expect(report.tables.find((table) => table.model === "QuickBooksExpense")).toMatchObject({ csvRows: 1301, imported: 1300, rejected: 1, databaseRows: 1300, matches: false });
    });
  }, 30000);
  it("imports reused source identifiers in two tenants and scopes the global catalog to both", async () => {
    await fixture(async (path) => {
      for (const name of ["organizations.csv", "crm_companies.csv", "crm_contacts.csv"]) {
        const file = join(path, name);
        const content = await readFile(file, "utf8");
        let row = content.split(/\r?\n/)[1].replace("org_northstar_001", "org_other");
        if (name === "crm_contacts.csv") row = row.replace("cmp_0244", "cmp_0001");
        await writeFile(file, content + row + "\n");
      }
      const store = new MemoryStore();
      const report = await ingestSynthetic(store, path);
      expect(report.issues).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.tables.find((table) => table.model === "MetricDefinition")?.databaseRows).toBe(16);
      expect(await store.count(catalog[1], ["org_other"])).toBe(1);
      expect(await store.count(catalog[2], ["org_other"])).toBe(1);
      expect((await ingestSynthetic(store, path)).tables).toEqual(report.tables);
    });
  }, 30000);
  it("refuses production and unknown environments", () => {
    expect(() => assertDevelopment("production")).toThrow("refusing");
    expect(() => assertDevelopment("staging")).toThrow("refusing");
    expect(() => assertDevelopment("test")).not.toThrow();
  });
});
