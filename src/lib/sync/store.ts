import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { SyncError } from "./errors";
import { normalizeCharge, normalizeCustomer, normalizeSubscription, type Context } from "./stripe/normalize";
import type { Resource } from "./stripe/connector";
type Row = Record<string, unknown> & { sourceHash?: string | null; sourceConnectionId?: string | null; syntheticDataset?: string | null };
type Delegate = { findUnique(args: object): Promise<Row | null>; update(args: object): Promise<unknown>; upsert(args: object): Promise<unknown> };
export async function writeStripeRow(db: PrismaClient, context: Context, runId: string, resource: Resource, raw: unknown, subscriptionId: string | null = null) {
  const data = resource === "customers" ? normalizeCustomer(raw, context) : resource === "subscriptions" ? normalizeSubscription(raw, context) : normalizeCharge(raw, subscriptionId, context);
  return db.$transaction(async (tx) => {
    // Lock the connection so lease ownership cannot change between this check
    // and the source write. All caller-provided content was validated above.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"sync:" + context.connectionId}))::text`;
    const connection = await tx.connection.findFirst({ where: { id: context.connectionId, organizationId: context.organizationId, activeRunId: runId, leaseUntil: { gt: new Date() } } });
    if (!connection) throw new SyncError("LEASE_LOST");
    const table = (resource === "customers" ? tx.stripeCustomer : resource === "subscriptions" ? tx.stripeSubscription : tx.stripePayment) as unknown as Delegate;
    const where = { organizationId_sourceSystem_sourceRecordId: { organizationId: context.organizationId, sourceSystem: "stripe", sourceRecordId: data.sourceRecordId } };
    const previous = await table.findUnique({ where });
    if (previous && (previous.syntheticDataset || previous.sourceConnectionId !== context.connectionId)) throw new SyncError("SOURCE_OWNERSHIP_CONFLICT");
    if (previous?.sourceHash === data.sourceHash) {
      await table.update({ where, data: { sourceObservedAt: context.now } }); return "unchanged";
    }
    const { ingestedAt: _ingestedAt, ...update } = data;
    const tombstone = resource === "customers" && data.sourceDeletedAt && previous ? { customerSince: previous.customerSince, sourceCreatedAt: previous.sourceCreatedAt, country: previous.country, sourceDeletedAt: previous.sourceDeletedAt ?? data.sourceDeletedAt } : {};
    try { await table.upsert({ where, create: data, update: { ...update, ...tombstone } }); }
    catch (error) { if (["P2002", "P2003"].includes((error as { code?: string }).code ?? "")) throw new SyncError("SOURCE_RELATIONSHIP_CONFLICT"); throw error; }
    return previous ? "updated" : "created";
  });
}
