import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { authenticate, requireMembership, HttpError } from "../auth/service";
import { periodBounds, requestSchema } from "../metrics/period";
import { metricCatalog, type MetricKey } from "../metrics/catalog";
import { subtract, calculate } from "../metrics/calculate";

export async function organizations(db: PrismaClient, request: Request) {
  const userId = await authenticate(db, request);
  const memberships = await db.membership.findMany({ where: { userId }, select: { role: true, organization: { select: { id: true, name: true, timezone: true, currency: true, syntheticDataset: true } } }, orderBy: { organizationId: "asc" } });
  return memberships.map(({ organization: { syntheticDataset, ...organization }, role }) => ({ ...organization, role, isDemo: Boolean(syntheticDataset) }));
}
export async function metrics(db: PrismaClient, request: Request) {
  const userId = await authenticate(db, request);
  const q = new URL(request.url).searchParams;
  const parsed = requestSchema.safeParse({ organizationId: q.get("organizationId"), from: q.get("from"), to: q.get("to") });
  if (!parsed.success) throw new HttpError(400, "Choose an organization and a valid start and exclusive end date");
  const input = parsed.data;
  await requireMembership(db, userId, input.organizationId);
  const comparison = z.object({ from: z.iso.date(), to: z.iso.date() }).refine((r) => r.from < r.to).safeParse({ from: q.get("compareFrom"), to: q.get("compareTo") });
  if ((q.has("compareFrom") || q.has("compareTo")) && !comparison.success) throw new HttpError(400, "Invalid comparison period");
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
    const definitions = await tx.metricDefinition.findMany({ where: { organizationId: input.organizationId, version: input.version } });
    const result = [];
    for (const key of Object.keys(metricCatalog) as MetricKey[]) {
      const definition = definitions.find((d) => d.key === key);
      if (!definition) { result.push({ key, name: key, unit: metricCatalog[key].unit, value: null, status: "NOT_COMPUTED", comparison: null }); continue; }
      async function find(from: string, to: string) {
        const bounds = await periodBounds(tx, from, to, definition!.timezone);
        return tx.metricValue.findUnique({ where: { organizationId_metricDefinitionId_periodStart_periodEnd: { organizationId: input.organizationId, metricDefinitionId: definition!.id, periodStart: bounds.start, periodEnd: bounds.end } }, select: { id: true, value: true, status: true, computedAt: true } });
      }
      const current = await find(input.from, input.to);
      const previous = comparison.success ? await find(comparison.data.from, comparison.data.to) : null;
      const value = current?.value?.toString() ?? null;
      const baseline = previous?.value?.toString() ?? null;
      // Percent metrics compare percentage points. Other metrics expose absolute
      // change; relative change is intentionally omitted for zero baselines.
      const delta = value !== null && baseline !== null ? subtract(value, baseline) : null;
      const relative = value !== null && baseline !== null && Number(baseline) > 0 ? calculate("web_conversion_rate", [{ numerator: subtract(value, baseline).replace(/^-/, ""), denominator: baseline }]).value : null;
      result.push({ key, name: definition.name, unit: definition.unit, currency: definition.currency, timezone: definition.timezone, version: definition.version, id: current?.id ?? null, value, status: current?.status ?? "NOT_COMPUTED", computedAt: current?.computedAt.toISOString() ?? null, comparison: comparison.success ? { value: baseline, status: previous?.status ?? "NOT_COMPUTED", delta, deltaUnit: definition.unit === "percent" ? "percentage points" : definition.unit, relativePercent: relative && delta?.startsWith("-") ? `-${relative}` : relative } : null });
    }
    return { organizationId: input.organizationId, from: input.from, toExclusive: input.to, metrics: result };
  }, { isolationLevel: "RepeatableRead" });
}
export async function evidence(db: PrismaClient, request: Request, id: string) {
  const userId = await authenticate(db, request);
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || !id || id.length > 200) throw new HttpError(400, "Organization and metric are required");
  await requireMembership(db, userId, organizationId);
  const metric = await db.metricValue.findFirst({ where: { id, organizationId }, select: { id: true, inputHash: true, engineVersion: true, calculationDetails: true, computedAt: true } });
  if (!metric) throw new HttpError(404, "Metric not found");
  return metric;
}
