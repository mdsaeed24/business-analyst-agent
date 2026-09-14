import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "../../generated/prisma/client";
import { SYNTHETIC_DATASET } from "../ingestion/normalizers/record";
import { metricCatalog, ENGINE_VERSION, type MetricKey } from "./catalog";
import { calculate } from "./calculate";
import { requestSchema, periodBounds, type MetricRequest } from "./period";
import { loadContributions } from "./sources";

// Trusted server/CLI boundary, not an authorization mechanism. Future HTTP callers
// must verify membership before invoking this service with an organization ID.
export async function computeMetrics(db: PrismaClient, input: MetricRequest) {
  const request = requestSchema.parse(input);
  return db.$transaction(async (tx) => {
    // Ensure source timestamps are decoded independently of server timezone.
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: request.organizationId } });
    const definitions = await tx.metricDefinition.findMany({ where: { organizationId: request.organizationId, version: request.version } });
    const results = [];
    for (const key of Object.keys(metricCatalog) as MetricKey[]) {
      const spec = metricCatalog[key];
      const definition = definitions.find((d) => d.key === key);
      if (!definition) throw new Error(`Missing metric definition: ${key}@${request.version}`);
      if (definition.unit !== spec.unit || definition.sourceTables.length !== 1 || definition.sourceTables[0] !== spec.table || (spec.unit === "currency" ? definition.currency !== "USD" || organization.currency !== "USD" : definition.currency !== null)) throw new Error(`Incompatible metric definition: ${key}`);
      const bounds = await periodBounds(tx, request.from, request.to, definition.timezone);
      const contributions = await loadContributions(tx, key, organization.id, request.from, request.to, bounds);
      const result = calculate(key, contributions);
      const details = {
        engineVersion: ENGINE_VERSION, key, definitionVersion: definition.version,
        definition: definition.definition, formula: spec.formula,
        from: request.from, toExclusive: request.to, timezone: definition.timezone,
        currency: definition.currency, unit: definition.unit,
        numerator: result.numerator, denominator: result.denominator, sourceCount: result.sourceCount,
        sources: contributions.map(({ source, numerator, denominator }) => ({ ...source, numerator, denominator })),
        limitations: key === "mrr" ? ["Historical MRR uses current stored plan amounts and start/cancel dates; plan change history is unavailable."] : key === "revenue_collected" ? ["Refunds are attributed to payment_date; refund event dates are unavailable."] : [],
      } satisfies Prisma.InputJsonObject;
      const inputHash = createHash("sha256").update(JSON.stringify(details)).digest("hex");
      const data = { value: result.value, status: result.status, engineVersion: ENGINE_VERSION, inputHash, calculationDetails: details, computedAt: new Date(), syntheticDataset: definition.syntheticDataset === SYNTHETIC_DATASET && contributions.every((c) => c.syntheticDataset === SYNTHETIC_DATASET) ? SYNTHETIC_DATASET : null };
      const persisted = await tx.metricValue.upsert({
        where: { organizationId_metricDefinitionId_periodStart_periodEnd: { organizationId: organization.id, metricDefinitionId: definition.id, periodStart: bounds.start, periodEnd: bounds.end } },
        create: { ...data, organizationId: organization.id, metricDefinitionId: definition.id, periodStart: bounds.start, periodEnd: bounds.end }, update: data,
      });
      results.push({ key, id: persisted.id, value: result.value, status: result.status, unit: spec.unit, currency: definition.currency, sourceCount: result.sourceCount, periodStart: bounds.start.toISOString(), periodEnd: bounds.end.toISOString(), inputHash });
    }
    return { organizationId: organization.id, from: request.from, toExclusive: request.to, definitionVersion: request.version, engineVersion: ENGINE_VERSION, results };
  }, { isolationLevel: "Serializable", timeout: 120000, maxWait: 10000 });
}
