import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { catalog, type Entry } from "./catalog";
import { SYNTHETIC_DATASET, type RecordData } from "./normalizers/record";
import { RecordImportError, type IngestionStore } from "./pipeline";

// A narrow adapter boundary for heterogeneous Prisma delegates. Table names and
// fields come exclusively from our static catalog and validated normalizers.
interface Delegate {
  findUnique(args: { where: RecordData }): Promise<RecordData | null>;
  upsert(args: { where: RecordData; create: RecordData; update: RecordData }): Promise<unknown>;
  count(args: { where: RecordData }): Promise<number>;
  deleteMany(args: { where: RecordData }): Promise<unknown>;
}
function delegate(tx: Prisma.TransactionClient, entry: Entry): Delegate {
  return tx[entry.delegate] as unknown as Delegate;
}
export function identity(entry: Entry, data: RecordData): RecordData {
  if (entry.model === "Organization") return { id: data.id };
  if (entry.model === "MetricDefinition") return { organizationId_key_version: { organizationId: data.organizationId, key: data.key, version: data.version } };
  return { organizationId_sourceSystem_sourceRecordId: { organizationId: data.organizationId, sourceSystem: data.sourceSystem, sourceRecordId: data.sourceRecordId } };
}
export function prismaStore(tx: Prisma.TransactionClient): IngestionStore {
  return {
    async upsert(entry, data) {
      await tx.$executeRawUnsafe("SAVEPOINT ingestion_row");
      try {
        const table = delegate(tx, entry);
        const where = identity(entry, data);
        const previous = await table.findUnique({ where });
        if (previous && previous.syntheticDataset !== SYNTHETIC_DATASET) throw new RecordImportError("Refusing to overwrite a record not owned by this synthetic dataset");
        if (previous && previous[entry.key] !== data[entry.key]) throw new RecordImportError("Source identity cannot change its business identifier");
        const { ingestedAt: _ingestedAt, ...update } = data;
        await table.upsert({ where, create: data, update });
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT ingestion_row");
      } catch (error) {
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT ingestion_row");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT ingestion_row");
        if (error instanceof RecordImportError) throw error;
        const code = (error as { code?: string }).code;
        if (["P2002", "P2003", "P2004"].includes(code ?? "")) throw new RecordImportError(`Database constraint rejected record (${code}); check duplicate identifiers and same-tenant relationships`);
        throw error;
      }
    },
    count(entry, organizationIds) {
      return delegate(tx, entry).count({ where: { syntheticDataset: SYNTHETIC_DATASET, [entry.model === "Organization" ? "id" : "organizationId"]: { in: organizationIds } } });
    },
  };
}

export async function withSyntheticTransaction<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
    // Serialize seed/reset commands. Transaction-scoped lock always releases on failure.
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(734129, 2)::text`;
    return work(tx);
  }, { maxWait: 10000, timeout: 600000 });
}

export function assertDevelopment(environment: string | undefined) {
  if (environment !== "development" && environment !== "test" && environment !== undefined) throw new Error("Synthetic commands are permitted only in development or test; refusing NODE_ENV=" + environment);
}
export async function resetSynthetic(db: PrismaClient, environment = process.env.NODE_ENV) {
  assertDevelopment(environment);
  return withSyntheticTransaction(db, async (tx) => {
    // No cascades. A non-synthetic dependent record blocks the reset and rolls back
    // all deletions, including any rows already deleted earlier in this transaction.
    await tx.metricValue.deleteMany({ where: { syntheticDataset: SYNTHETIC_DATASET } });
    for (const entry of [...catalog].reverse()) {
      await delegate(tx, entry).deleteMany({ where: { syntheticDataset: SYNTHETIC_DATASET } });
    }
  });
}
