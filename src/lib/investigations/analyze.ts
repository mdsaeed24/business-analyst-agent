import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client";
import { metricCatalog, type MetricKey } from "../metrics/catalog";
import { calculate } from "../metrics/calculate";
const Decimal = Prisma.Decimal.clone({ precision: 60, rounding: Prisma.Decimal.ROUND_HALF_UP });
export const INVESTIGATION_VERSION = "1.0.0";
export const investigationSchema = z.strictObject({
  organizationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/),
  from: z.iso.date(), to: z.iso.date(), compareFrom: z.iso.date(), compareTo: z.iso.date(),
}).refine((p) => p.from < p.to && p.compareFrom < p.compareTo && p.compareTo <= p.from, "Choose non-overlapping periods, with the comparison before the current period")
  .refine((p) => days(p.from, p.to) <= 366 && days(p.compareFrom, p.compareTo) <= 366, "Each period must be at most 366 calendar days");
export type InvestigationInput = z.infer<typeof investigationSchema>;
export const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
const nonnegative = z.string().regex(/^\d+(\.\d+)?$/);
export const snapshotSchema = z.object({
  key: z.string(), definitionVersion: z.literal("1.0"), engineVersion: z.literal("1.0.0"),
  from: z.iso.date(), toExclusive: z.iso.date(), timezone: z.string(), unit: z.string(), currency: z.string().nullable(),
  sourceCount: z.number().int().nonnegative(), numerator: nonnegative, denominator: nonnegative,
  sources: z.array(z.object({ organizationId: z.string(), sourceRecordId: z.string(), numerator: nonnegative, denominator: nonnegative }).passthrough()),
  limitations: z.array(z.string()),
}).passthrough();
export type Snapshot = z.infer<typeof snapshotSchema>;
export type SavedMetric = { id: string; value: string | null; status: string; inputHash: string | null; snapshot: Snapshot };
export const rules = {
  revenue_collected: { threshold: "20", basis: "relative percent", next: "Review the payment and refund records behind the change." },
  mrr: { threshold: "20", basis: "relative percent", next: "Review included subscriptions and cancellation dates; plan-change history is unavailable." },
  new_customers: { threshold: "20", basis: "relative percent", next: "Review customer acquisition records for each period." },
  pipeline_created: { threshold: "20", basis: "relative percent", next: "Review deal creation and amounts for the largest listed contributors." },
  win_rate: { threshold: "5", basis: "percentage points", next: "Review closed-won and closed-lost outcomes; this comparison does not explain why deals changed." },
  web_conversion_rate: { threshold: "0.5", basis: "percentage points", next: "Review channel contributions, traffic mix, and conversion counts." },
  support_volume: { threshold: "20", basis: "relative percent", next: "Review support workload and capacity; increased volume does not by itself establish worse service." },
  avg_first_response: { threshold: "20", basis: "relative percent", next: "Review response-time records and workload before drawing conclusions about service quality." },
} as const;
const groupFields: Record<MetricKey, string> = { revenue_collected: "paymentId", mrr: "subscriptionId", new_customers: "customerId", pipeline_created: "dealId", win_rate: "stage", web_conversion_rate: "channel", support_volume: "ticketId", avg_first_response: "ticketId" };
export function fingerprint(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, value]) => [k, canonical(value)]));
    return v;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function validateSnapshot(key: MetricKey, saved: SavedMetric, organizationId: string, from: string, to: string) {
  const s = saved.snapshot;
  if (s.key !== key || s.from !== from || s.toExclusive !== to || s.unit !== metricCatalog[key].unit || (s.unit === "currency" ? s.currency !== "USD" : s.currency !== null) || s.sourceCount !== s.sources.length || s.sources.some((r) => r.organizationId !== organizationId)) throw new Error("Metric snapshot metadata mismatch");
  const recomputed = calculate(key, s.sources);
  if (recomputed.status !== saved.status || (recomputed.value === null ? saved.value !== null : saved.value === null || !new Decimal(recomputed.value).eq(saved.value)) || !new Decimal(recomputed.numerator).eq(s.numerator) || !new Decimal(recomputed.denominator).eq(s.denominator)) throw new Error("Metric snapshot does not reproduce the saved value");
}
function contributions(key: MetricKey, current: Snapshot, baseline: Snapshot, delta: string) {
  const groups = new Map<string, { current: InstanceType<typeof Decimal>; baseline: InstanceType<typeof Decimal> }>();
  for (const [side, snapshot] of [["current", current], ["baseline", baseline]] as const) {
    for (const row of snapshot.sources) {
      const label = String(row[groupFields[key]] ?? row.sourceRecordId);
      const group = groups.get(label) ?? { current: new Decimal(0), baseline: new Decimal(0) };
      let term = new Decimal(row.numerator);
      if (metricCatalog[key].mode !== "sum") term = term.div(snapshot.denominator).mul(metricCatalog[key].mode === "percent" ? 100 : 1);
      group[side] = group[side].plus(term); groups.set(label, group);
    }
  }
  const all = [...groups].map(([label, group]) => ({ label, current: group.current.toFixed(8), baseline: group.baseline.toFixed(8), delta: group.current.minus(group.baseline).toFixed(8) })).sort((a, b) => new Decimal(b.delta).abs().comparedTo(new Decimal(a.delta).abs()) || a.label.localeCompare(b.label, "en"));
  const top = all.slice(0, 5);
  const accounted = top.reduce((sum, row) => sum.plus(row.delta), new Decimal(0));
  return { dimension: groupFields[key], top, remainingDelta: new Decimal(delta).minus(accounted).toFixed(8), groupCount: all.length, explanation: "Arithmetic contributions to the total change, not causal explanations. For rates/averages, each group is divided by its period's total denominator; mix and volume changes are included." };
}
export function analyze(key: MetricKey, current: SavedMetric | null, baseline: SavedMetric | null, input: InvestigationInput) {
  const rule = rules[key];
  const result = { key, name: key.replaceAll("_", " "), unit: metricCatalog[key].unit, rule: { ...rule, minimumSourceRecords: 10 }, current: current?.value ?? null, baseline: baseline?.value ?? null, delta: null as string | null, relativePercent: null as string | null, significant: false, state: "MISSING_METRIC", direction: "unknown", statement: "One or both periods have no saved metric.", nextStep: rule.next, limitations: [...new Set([...(current?.snapshot.limitations ?? []), ...(baseline?.snapshot.limitations ?? []), "Observed changes and arithmetic contributors do not establish business causes."])], breakdown: null as ReturnType<typeof contributions> | null };
  if (!current || !baseline) return result;
  if (current.value === null || baseline.value === null) return { ...result, state: "INSUFFICIENT_DATA", statement: "A period has an undefined ratio or average; no change is inferred." };
  const delta = new Decimal(current.value).minus(baseline.value);
  result.delta = delta.toFixed(8);
  result.direction = delta.isZero() ? "unchanged" : delta.isPositive() ? "increased" : "decreased";
  result.relativePercent = new Decimal(baseline.value).isZero() ? null : delta.div(baseline.value).mul(100).toFixed(8);
  result.breakdown = contributions(key, current.snapshot, baseline.snapshot, result.delta);
  result.statement = `${result.name} ${result.direction}; current ${current.value}, comparison ${baseline.value}, change ${result.delta} ${result.unit === "percent" ? "percentage points" : result.unit === "currency" ? "USD" : result.unit === "duration" ? "minutes" : "records"}.`;
  if (current.snapshot.timezone !== baseline.snapshot.timezone) return { ...result, state: "INCOMPARABLE", statement: "Reporting timezones differ; automatic significance is disabled." };
  if (metricCatalog[key].mode === "sum" && key !== "mrr" && days(input.from, input.to) !== days(input.compareFrom, input.compareTo)) return { ...result, state: "INCOMPARABLE", statement: result.statement + " Period lengths differ; automatic significance for totals is disabled." };
  if (current.snapshot.sourceCount < 10 || baseline.snapshot.sourceCount < 10) return { ...result, state: "SMALL_SAMPLE", statement: result.statement + " Fewer than ten source records in a period; no significance flag." };
  if (rule.basis === "relative percent" && result.relativePercent === null) return { ...result, state: "ZERO_BASELINE", statement: result.statement + " Relative change is undefined for a zero baseline." };
  const magnitude = rule.basis === "percentage points" ? delta.abs() : delta.div(baseline.value).mul(100).abs();
  result.significant = magnitude.gte(rule.threshold);
  return { ...result, state: result.significant ? "SIGNIFICANT_CHANGE" : "BELOW_THRESHOLD", statement: result.statement + (result.significant ? ` Meets the ${rule.threshold} ${rule.basis} rule; this is not a statistical significance test.` : ` Below the ${rule.threshold} ${rule.basis} rule.`) };
}
export type Finding = ReturnType<typeof analyze>;
