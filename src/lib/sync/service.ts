import type { PrismaClient, Prisma } from "../../generated/prisma/client";
import { SyncError } from "./errors";
import { stripeCredential, StripeReader } from "./stripe/client";
import { importStripe, type Issue } from "./stripe/connector";
import { writeStripeRow } from "./store";
import type { FetchJson } from "./http";
export async function runSync(db: PrismaClient, connectionId: string, options: { full?: boolean; http?: FetchJson; env?: Record<string, string | undefined> } = {}) {
  const claim = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"sync:" + connectionId}))::text`;
    const connection = await tx.connection.findUniqueOrThrow({ where: { id: connectionId }, include: { organization: true } });
    if (connection.provider !== "STRIPE" || connection.organization.syntheticDataset) throw new SyncError("LIVE_ORGANIZATION_REQUIRED");
    if (!connection.externalAccountId || connection.liveMode === null) throw new SyncError("CONNECTION_NOT_CONFIGURED");
    const now = new Date();
    if (connection.activeRunId && connection.leaseUntil && connection.leaseUntil > now) throw new SyncError("SYNC_ALREADY_RUNNING");
    if (connection.activeRunId) await tx.syncRun.updateMany({ where: { id: connection.activeRunId, connectionId, status: "RUNNING" }, data: { status: "FAILED", completedAt: now, errorCode: "LEASE_EXPIRED" } });
    const fullSync = options.full || connection.requestedFullSync || !connection.syncWatermark;
    const cutoff = new Date(Math.floor((now.getTime() - 60000) / 1000) * 1000);
    const run = await tx.syncRun.create({ data: { organizationId: connection.organizationId, connectionId, fullSync, cutoff } });
    await tx.connection.update({ where: { id: connectionId }, data: { activeRunId: run.id, leaseUntil: new Date(now.getTime() + 300000), syncRequestedAt: null, requestedFullSync: false } });
    return { connection, run };
  });
  const { connection, run } = claim;
  const counts = { customers: { created: 0, updated: 0, unchanged: 0 }, subscriptions: { created: 0, updated: 0, unchanged: 0 }, payments: { created: 0, updated: 0, unchanged: 0 } };
  const issues: Issue[] = []; let issueCount = 0, requests = 0;
  async function heartbeat() {
    if (Date.now() - run.startedAt.getTime() > 30 * 60000) throw new SyncError("RUN_TIME_LIMIT");
    const update = await db.connection.updateMany({ where: { id: connectionId, activeRunId: run.id, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + 300000) } });
    if (update.count !== 1) throw new SyncError("LEASE_LOST");
  }
  let status: "COMPLETED" | "PARTIAL" | "FAILED" = "COMPLETED", errorCode: string | null = null;
  try {
    const key = stripeCredential(connection.secretReference, connection.liveMode, options.env);
    const reader = new StripeReader(key, connection.liveMode!, options.http, heartbeat);
    try {
      await reader.verify(connection.externalAccountId!);
      await importStripe(reader, {
        heartbeat,
        async write(resource, raw, subscriptionId) {
          const result = await writeStripeRow(db, { organizationId: connection.organizationId, connectionId, timezone: connection.organization.timezone, now: new Date() }, run.id, resource, raw, subscriptionId);
          counts[resource][result]++;
        },
        issue(issue) { issueCount++; if (issues.length < 100) issues.push(issue); },
        async knownCustomerIds() { return (await db.stripeCustomer.findMany({ where: { organizationId: connection.organizationId, sourceConnectionId: connectionId }, select: { customerId: true } })).map((r) => r.customerId); },
      }, run.cutoff, run.fullSync ? null : connection.syncWatermark);
      if (issueCount) status = "PARTIAL";
    } finally { requests = reader.requests; }
  } catch (error) { status = "FAILED"; errorCode = error instanceof SyncError ? error.code : "INVALID_PROVIDER_DATA_OR_DATABASE_ERROR"; }
  const report = { counts, issueCount, issues, requests };
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"sync:" + connectionId}))::text`;
    const current = await tx.connection.findUniqueOrThrow({ where: { id: connectionId } });
    if (current.activeRunId !== run.id) throw new SyncError("LEASE_LOST");
    const now = new Date();
    await tx.syncRun.update({ where: { id: run.id }, data: { status, errorCode, report: report as unknown as Prisma.InputJsonValue, completedAt: now } });
    await tx.connection.update({ where: { id: connectionId }, data: { activeRunId: null, leaseUntil: null, status: status === "COMPLETED" ? "CONNECTED" : "ERROR", ...(status === "COMPLETED" ? { lastSyncedAt: now, syncWatermark: run.cutoff } : {}), nextSyncAt: new Date(now.getTime() + current.syncIntervalMinutes * 60000) } });
  });
  return { id: run.id, connectionId, status, errorCode, report };
}
export async function runDueSyncs(db: PrismaClient, options: { env?: Record<string, string | undefined>; http?: FetchJson } = {}) {
  const due = await db.connection.findMany({ where: { provider: "STRIPE", secretReference: { not: null }, OR: [{ syncRequestedAt: { not: null } }, { syncEnabled: true, OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: new Date() } }] }] }, orderBy: { nextSyncAt: "asc" }, take: 20, select: { id: true } });
  const results = [];
  for (const connection of due) {
    try { results.push(await runSync(db, connection.id, options)); }
    catch (error) { results.push({ connectionId: connection.id, status: "SKIPPED", errorCode: error instanceof SyncError ? error.code : "SYNC_CLAIM_FAILED" }); }
  }
  return results;
}
