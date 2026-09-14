import type { PrismaClient, Prisma } from "../../generated/prisma/client";
import { HttpError, authenticate, requireMembership, requireSameOrigin } from "../auth/service";
import { metricCatalog, type MetricKey } from "../metrics/catalog";
import { periodBounds } from "../metrics/period";
import { analyze, fingerprint, investigationSchema, INVESTIGATION_VERSION, snapshotSchema, validateSnapshot, type SavedMetric, type Finding } from "./analyze";

export async function runInvestigation(db: PrismaClient, userId: string, raw: unknown) {
  const parsed = investigationSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
        const membership = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: input.organizationId, userId } } });
        if (!membership) throw new HttpError(403, "Organization access denied");
        if (membership.role === "VIEWER") throw new HttpError(403, "Analyst, admin or owner access is required to run investigations");
        const definitions = await tx.metricDefinition.findMany({ where: { organizationId: input.organizationId, version: "1.0" } });
        const findings: Finding[] = [];
        const snapshots: { key: MetricKey; current: SavedMetric | null; baseline: SavedMetric | null }[] = [];
        for (const key of Object.keys(metricCatalog) as MetricKey[]) {
          const definition = definitions.find((d) => d.key === key);
          async function load(from: string, to: string): Promise<SavedMetric | null> {
            if (!definition) return null;
            const bounds = await periodBounds(tx, from, to, definition.timezone);
            const row = await tx.metricValue.findUnique({ where: { organizationId_metricDefinitionId_periodStart_periodEnd: { organizationId: input.organizationId, metricDefinitionId: definition.id, periodStart: bounds.start, periodEnd: bounds.end } } });
            if (!row) return null;
            const snapshot = snapshotSchema.safeParse(row.calculationDetails);
            if (!snapshot.success || snapshot.data.timezone !== definition.timezone) throw new HttpError(409, `Recompute ${key}: its saved evidence is missing or incompatible`);
            const saved = { id: row.id, value: row.value?.toString() ?? null, status: row.status, inputHash: row.inputHash, snapshot: snapshot.data };
            try { validateSnapshot(key, saved, input.organizationId, from, to); } catch { throw new HttpError(409, `Recompute ${key}: its saved evidence does not match the metric`); }
            return saved;
          }
          const current = await load(input.from, input.to), baseline = await load(input.compareFrom, input.compareTo);
          snapshots.push({ key, current, baseline }); findings.push(analyze(key, current, baseline, input));
        }
        if (!snapshots.some((s) => s.current && s.baseline)) throw new HttpError(409, "Compute at least one metric for both periods before starting an investigation");
        const inputHash = fingerprint({ version: INVESTIGATION_VERSION, input, snapshots });
        const existing = await tx.investigation.findUnique({ where: { organizationId_inputHash: { organizationId: input.organizationId, inputHash } } });
        if (existing) return { ...existing, reused: true };
        const flagged = findings.filter((f) => f.significant);
        const incomplete = findings.filter((f) => !["SIGNIFICANT_CHANGE", "BELOW_THRESHOLD"].includes(f.state));
        const summary = `${flagged.length} of 8 metrics meet the configured change rules${flagged.length ? `: ${flagged.map((f) => f.name).join(", ")}` : ""}. ${incomplete.length} metrics require caution or more data. Findings describe changes, not proven causes.`;
        const now = new Date();
        const row = await tx.investigation.create({ data: {
          organizationId: input.organizationId, requestedByMembershipId: membership.id,
          question: `Compare ${input.from}–${input.to} against ${input.compareFrom}–${input.compareTo} (exclusive end dates)`,
          status: "COMPLETED", summary, startedAt: now, completedAt: now,
          engineVersion: INVESTIGATION_VERSION, inputHash, parameters: input,
          findings: findings as unknown as Prisma.InputJsonValue,
        } });
        await tx.evidenceItem.createMany({ data: snapshots.filter((s) => s.current || s.baseline).map((s) => ({
          investigationId: row.id, organizationId: input.organizationId, metricValueId: s.current?.id ?? s.baseline!.id,
          title: s.key, description: findings.find((f) => f.key === s.key)!.statement,
          details: { current: s.current, baseline: s.baseline, investigationVersion: INVESTIGATION_VERSION } as unknown as Prisma.InputJsonValue,
        })) });
        return { ...row, reused: false };
      }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 60000 });
    } catch (error) {
      if (attempt < 2 && ["P2034", "P2002"].includes((error as { code?: string }).code ?? "")) continue;
      throw error;
    }
  }
}
export async function createFromRequest(db: PrismaClient, request: Request) {
  requireSameOrigin(request);
  const userId = await authenticate(db, request);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body required");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new HttpError(413, "Request too large"); }
    chunks.push(value);
  }
  let input: unknown;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON body"); }
  return runInvestigation(db, userId, input);
}
async function access(db: PrismaClient, request: Request) {
  const userId = await authenticate(db, request), organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || organizationId.length > 200) throw new HttpError(400, "Organization is required");
  await requireMembership(db, userId, organizationId); return organizationId;
}
export async function listInvestigations(db: PrismaClient, request: Request) {
  const organizationId = await access(db, request);
  return db.investigation.findMany({ where: { organizationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, question: true, summary: true, status: true, createdAt: true, parameters: true, engineVersion: true } });
}
export async function getInvestigation(db: PrismaClient, request: Request, id: string) {
  const organizationId = await access(db, request);
  const row = await db.investigation.findFirst({ where: { id, organizationId }, include: { evidenceItems: { orderBy: { title: "asc" } } } });
  if (!row) throw new HttpError(404, "Investigation not found");
  return row;
}
