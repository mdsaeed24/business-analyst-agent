import { describe, expect, it } from "vitest";
import { analyze, fingerprint, investigationSchema, validateSnapshot, type SavedMetric } from "../src/lib/investigations/analyze";
import { calculate } from "../src/lib/metrics/calculate";
import { metricCatalog, type MetricKey } from "../src/lib/metrics/catalog";
const input = { organizationId: "org", from: "2026-08-01", to: "2026-09-01", compareFrom: "2026-07-01", compareTo: "2026-08-01" };
function saved(key: MetricKey, numerator: string, denominator = "1", baseline = false, count = 10): SavedMetric {
  const sources = Array.from({ length: count }, (_, i) => ({ organizationId: "org", sourceRecordId: String(i), channel: i % 2 ? "organic" : "paid", numerator, denominator }));
  const result = calculate(key, sources);
  return { id: baseline ? "before" : "after", inputHash: null, value: result.value, status: result.status, snapshot: { ...result, key, definitionVersion: "1.0", engineVersion: "1.0.0", from: baseline ? input.compareFrom : input.from, toExclusive: baseline ? input.compareTo : input.to, timezone: "UTC", unit: metricCatalog[key].unit, currency: metricCatalog[key].unit === "currency" ? "USD" : null, sources, limitations: [] } };
}
describe("deterministic investigations", () => {
  it("validates dates, period order and bounded ranges", () => {
    expect(investigationSchema.safeParse(input).success).toBe(true);
    for (const change of [{ from: "2026-02-30" }, { compareTo: "2026-08-02" }, { compareFrom: "2020-01-01" }, { extra: true }]) expect(investigationSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it("uses inclusive thresholds without rounding into a flag", () => {
    expect(analyze("revenue_collected", saved("revenue_collected", "12"), saved("revenue_collected", "10", "1", true), input).significant).toBe(true);
    expect(analyze("revenue_collected", saved("revenue_collected", "11.999999999"), saved("revenue_collected", "10", "1", true), input).significant).toBe(false);
    expect(analyze("win_rate", saved("win_rate", "55", "100"), saved("win_rate", "50", "100", true), input).state).toBe("SIGNIFICANT_CHANGE");
  });
  it("handles missing, undefined, small samples and zero baselines", () => {
    expect(analyze("mrr", null, null, input).state).toBe("MISSING_METRIC");
    expect(analyze("win_rate", saved("win_rate", "0", "0"), saved("win_rate", "1"), input).state).toBe("INSUFFICIENT_DATA");
    expect(analyze("mrr", saved("mrr", "100", "1", false, 2), saved("mrr", "10"), input).state).toBe("SMALL_SAMPLE");
    expect(analyze("mrr", saved("mrr", "10"), saved("mrr", "0"), input).state).toBe("ZERO_BASELINE");
  });
  it("rejects unequal duration totals and timezone comparisons", () => {
    expect(analyze("revenue_collected", saved("revenue_collected", "20"), saved("revenue_collected", "10"), { ...input, compareFrom: "2026-07-02" }).state).toBe("INCOMPARABLE");
    const before = saved("mrr", "10"); before.snapshot.timezone = "America/New_York";
    expect(analyze("mrr", saved("mrr", "20"), before, input).state).toBe("INCOMPARABLE");
  });
  it("accounts for rate denominator changes and reconciles top contributors", () => {
    const finding = analyze("web_conversion_rate", saved("web_conversion_rate", "2", "50"), saved("web_conversion_rate", "2", "100", true), input);
    expect(finding.delta).toBe("2.00000000");
    expect(finding.breakdown?.top.map((r) => r.delta)).toEqual(["1.00000000", "1.00000000"]);
    expect(finding.breakdown?.remainingDelta).toBe("0.00000000");
    const total = analyze("mrr", saved("mrr", "20"), saved("mrr", "10"), input);
    expect(total.breakdown?.remainingDelta).toBe("50.00000000");
  });
  it("rejects mismatched tenants and corrupt saved values", () => {
    const row = saved("mrr", "10");
    expect(() => validateSnapshot("mrr", row, "org", input.from, input.to)).not.toThrow();
    expect(() => validateSnapshot("mrr", row, "other", input.from, input.to)).toThrow();
    row.value = "101";
    expect(() => validateSnapshot("mrr", row, "org", input.from, input.to)).toThrow();
  });
  it("fingerprints JSON independently of database object key ordering", () => {
    expect(fingerprint({ a: 1, nested: { x: 2, y: 3 } })).toBe(fingerprint({ nested: { y: 3, x: 2 }, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});
