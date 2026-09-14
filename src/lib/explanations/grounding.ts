import { z } from "zod";
import { analyze, investigationSchema, snapshotSchema, validateSnapshot, type SavedMetric } from "../investigations/analyze";
import { metricCatalog, type MetricKey } from "../metrics/catalog";
export const PROMPT_VERSION = "1.0.0";
const savedSchema = z.object({ id: z.string(), value: z.string().nullable(), status: z.enum(["COMPUTED", "NO_DATA"]), inputHash: z.string().nullable(), snapshot: snapshotSchema });
const pairSchema = z.object({ current: savedSchema.nullable(), baseline: savedSchema.nullable(), investigationVersion: z.literal("1.0.0") });
export function buildGrounding(investigation: { organizationId: string; engineVersion: string | null; parameters: unknown; status: string; evidenceItems: { id: string; organizationId: string; title: string; details: unknown }[] }) {
  if (investigation.status !== "COMPLETED" || investigation.engineVersion !== "1.0.0") throw new Error("Unsupported investigation");
  const input = investigationSchema.parse(investigation.parameters);
  if (input.organizationId !== investigation.organizationId) throw new Error("Tenant mismatch");
  const references: { ref: string; evidenceId: string; key: MetricKey; statement: string }[] = [];
  const metrics = Object.keys(metricCatalog).map((k, index) => {
    const key = k as MetricKey, ref = `M${index + 1}`;
    const evidence = investigation.evidenceItems.filter((e) => e.title === key);
    if (evidence.length > 1) throw new Error("Duplicate evidence");
    let current: SavedMetric | null = null, baseline: SavedMetric | null = null;
    if (evidence[0]) {
      if (evidence[0].organizationId !== input.organizationId) throw new Error("Tenant mismatch");
      ({ current, baseline } = pairSchema.parse(evidence[0].details));
      if (current) validateSnapshot(key, current, input.organizationId, input.from, input.to);
      if (baseline) validateSnapshot(key, baseline, input.organizationId, input.compareFrom, input.compareTo);
    }
    const finding = analyze(key, current, baseline, input);
    if (evidence[0]) references.push({ ref, evidenceId: evidence[0].id, key, statement: finding.statement });
    // Explicit projection excludes source records, IDs, descriptions, names,
    // free-form questions, dictionary text and saved model output.
    return { ref, key, hasEvidence: Boolean(evidence[0]), state: finding.state, direction: finding.direction, current: finding.current, baseline: finding.baseline, delta: finding.delta, relativePercent: finding.relativePercent, unit: finding.unit, significant: finding.significant, threshold: finding.rule.threshold, thresholdBasis: finding.rule.basis, followUp: finding.nextStep };
  });
  if (!references.length) throw new Error("No evidence");
  return { packet: { from: input.from, toExclusive: input.to, compareFrom: input.compareFrom, compareToExclusive: input.compareTo, metrics, limitations: ["Changes do not establish causes.", "MRR uses stored plan amounts; historical plan changes are unavailable.", "Refunds are attributed to payment dates.", "Change rules are not statistical significance tests.", "Missing or small samples cannot support confident conclusions."] }, references };
}
export type Grounding = ReturnType<typeof buildGrounding>;
const prose = z.string().trim().min(10).max(700).refine((s) => !/[\d$%<>]|https?:|www\./i.test(s), "Use qualitative plain text without figures or links");
const outputSchema = z.strictObject({ insights: z.array(z.strictObject({ reference: z.string(), explanation: prose, suggestedCheck: prose })).min(1).max(8) });
export function validateExplanation(raw: unknown, grounding: Grounding) {
  const parsed = outputSchema.parse(raw);
  const seen = new Set<string>();
  const insights = parsed.insights.map((item) => {
    const source = grounding.references.find((r) => r.ref === item.reference);
    if (!source || seen.has(item.reference)) throw new Error("Invalid evidence reference");
    seen.add(item.reference);
    return { ...item, evidenceId: source.evidenceId, key: source.key, verifiedStatement: source.statement };
  });
  return { insights };
}
export type ExplanationContent = ReturnType<typeof validateExplanation>;
