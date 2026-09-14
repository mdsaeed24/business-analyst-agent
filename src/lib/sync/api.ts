import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { authenticate, requireMembership, requireSameOrigin, HttpError } from "../auth/service";
async function access(db: PrismaClient, request: Request) {
  const userId = await authenticate(db, request), organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || organizationId.length > 200) throw new HttpError(400, "Organization is required");
  const member = await requireMembership(db, userId, organizationId);
  return { organizationId, member };
}
export async function listConnections(db: PrismaClient, request: Request) {
  const { organizationId } = await access(db, request);
  const rows = await db.connection.findMany({ where: { organizationId, provider: "STRIPE", secretReference: { not: null } }, select: { id: true, name: true, provider: true, status: true, externalAccountId: true, liveMode: true, syncEnabled: true, syncIntervalMinutes: true, nextSyncAt: true, lastSyncedAt: true, syncWatermark: true, syncRequestedAt: true, activeRunId: true, leaseUntil: true, syncRuns: { orderBy: { startedAt: "desc" }, take: 10, select: { id: true, status: true, fullSync: true, startedAt: true, completedAt: true, errorCode: true, report: true } } } });
  return Promise.all(rows.map(async (row) => ({ ...row, workerEnabled: process.env.LIVE_SYNC_ENABLED === "true", counts: { customers: await db.stripeCustomer.count({ where: { organizationId, sourceConnectionId: row.id } }), subscriptions: await db.stripeSubscription.count({ where: { organizationId, sourceConnectionId: row.id } }), payments: await db.stripePayment.count({ where: { organizationId, sourceConnectionId: row.id } }) } })));
}
const actionSchema = z.strictObject({ action: z.enum(["sync", "full-sync", "enable-schedule", "disable-schedule"]) });
export async function connectionAction(db: PrismaClient, request: Request, id: string) {
  requireSameOrigin(request);
  const { organizationId, member } = await access(db, request);
  if (!["OWNER", "ADMIN"].includes(member.role)) throw new HttpError(403, "Owner or admin access is required to manage synchronization");
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, "Action required");
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024) { await reader.cancel(); throw new HttpError(413, "Request too large"); } chunks.push(value); }
  let input;
  try { input = actionSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { throw new HttpError(400, "Invalid synchronization action"); }
  const connection = await db.connection.findFirst({ where: { id, organizationId, provider: "STRIPE", secretReference: { not: null } } });
  if (!connection) throw new HttpError(404, "Connection not found");
  const data = input.action === "disable-schedule" ? { syncEnabled: false } : input.action === "enable-schedule" ? { syncEnabled: true, nextSyncAt: new Date() } : { syncRequestedAt: new Date(), ...(input.action === "full-sync" ? { requestedFullSync: true } : {}) };
  await db.connection.update({ where: { id: connection.id }, data });
  return { accepted: true, action: input.action, message: input.action.includes("schedule") ? "Schedule updated. The sync worker must be running." : "Sync queued. The sync worker will process it." };
}
