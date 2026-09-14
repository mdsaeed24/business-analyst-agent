import type { Prisma } from "../../generated/prisma/client";
import { subtract, type Term } from "./calculate";
import type { MetricKey } from "./catalog";
function required(value: { toString(): string } | null, key: string): string { if (value === null) throw new Error(`Live ${key} requires an explicit currency/billing metric definition; no partial metric batch was saved`); return value.toString(); }
const lineage = { id: true, organizationId: true, sourceSystem: true, sourceRecordId: true, sourceUpdatedAt: true, ingestedAt: true, normalizedAt: true, syntheticDataset: true } as const;
export type Contribution = Term & { source: Prisma.InputJsonObject; syntheticDataset: string | null };
function contribute(row: { organizationId: string; syntheticDataset: string | null }, numerator: string, denominator = "0"): Contribution {
  return { numerator, denominator, source: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject, syntheticDataset: row.syntheticDataset };
}
export async function loadContributions(tx: Prisma.TransactionClient, key: MetricKey, organizationId: string, from: string, to: string, bounds: { start: Date; end: Date }): Promise<Contribution[]> {
  const dates = { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) };
  const orderBy = [{ sourceRecordId: "asc" as const }, { id: "asc" as const }];
  switch (key) {
    case "revenue_collected": return (await tx.stripePayment.findMany({ where: { organizationId, paymentDate: dates, status: "succeeded" }, orderBy, select: { ...lineage, paymentId: true, paymentDate: true, status: true, amountUsd: true, refundAmountUsd: true } })).map((r) => contribute(r, subtract(required(r.amountUsd, "revenue_collected"), required(r.refundAmountUsd, "revenue_collected"))));
    case "mrr": return (await tx.stripeSubscription.findMany({ where: { organizationId, startDate: { lt: dates.lt }, OR: [{ cancelDate: null }, { cancelDate: { gte: dates.lt } }] }, orderBy, select: { ...lineage, subscriptionId: true, startDate: true, cancelDate: true, status: true, monthlyRecurringRevenueUsd: true } })).map((r) => contribute(r, required(r.monthlyRecurringRevenueUsd, "mrr")));
    case "new_customers": return (await tx.stripeCustomer.findMany({ where: { organizationId, customerSince: dates }, orderBy, select: { ...lineage, customerId: true, customerSince: true } })).map((r) => contribute(r, "1"));
    case "pipeline_created": return (await tx.cRMDeal.findMany({ where: { organizationId, createdDate: dates }, orderBy, select: { ...lineage, dealId: true, createdDate: true, amountUsd: true } })).map((r) => contribute(r, r.amountUsd.toString()));
    case "win_rate": return (await tx.cRMDeal.findMany({ where: { organizationId, closeDate: dates, stage: { in: ["closed_won", "closed_lost"] } }, orderBy, select: { ...lineage, dealId: true, closeDate: true, stage: true } })).map((r) => contribute(r, r.stage === "closed_won" ? "1" : "0", "1"));
    case "web_conversion_rate": return (await tx.gA4DailyMetric.findMany({ where: { organizationId, date: dates }, orderBy, select: { ...lineage, date: true, channel: true, sessions: true, conversions: true } })).map((r) => contribute(r, String(r.conversions), String(r.sessions)));
    case "support_volume":
    case "avg_first_response": return (await tx.supportTicket.findMany({ where: { organizationId, createdAt: { gte: bounds.start, lt: bounds.end } }, orderBy, select: { ...lineage, ticketId: true, createdAt: true, firstResponseMinutes: true } })).map((r) => contribute(r, key === "support_volume" ? "1" : String(r.firstResponseMinutes), "1"));
  }
}
