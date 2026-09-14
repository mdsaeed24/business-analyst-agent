import { describe, expect, it } from "vitest";
import { calculate, subtract } from "../src/lib/metrics/calculate";
import { requestSchema } from "../src/lib/metrics/period";

describe("deterministic metric arithmetic", () => {
  it("preserves cents beyond binary float precision and subtracts refunds exactly", () => {
    expect(subtract("900719925474099.99", "0.01")).toBe("900719925474099.98");
    expect(calculate("revenue_collected", [{ numerator: "0.1", denominator: "0" }, { numerator: "0.2", denominator: "0" }]).value).toBe("0.30000000");
  });
  it("weights conversion rates by sessions rather than averaging daily percentages", () => {
    expect(calculate("web_conversion_rate", [{ numerator: "1", denominator: "2" }, { numerator: "1", denominator: "98" }]).value).toBe("2.00000000");
  });
  it("uses percentage points and rounds once to eight decimal places", () => {
    expect(calculate("win_rate", [{ numerator: "1", denominator: "3" }]).value).toBe("33.33333333");
    expect(calculate("avg_first_response", [{ numerator: "2", denominator: "3" }]).value).toBe("0.66666667");
  });
  it("distinguishes undefined denominators from valid zero totals", () => {
    expect(calculate("win_rate", [])).toMatchObject({ value: null, status: "NO_DATA" });
    expect(calculate("avg_first_response", [])).toMatchObject({ value: null, status: "NO_DATA" });
    expect(calculate("new_customers", [])).toMatchObject({ value: "0.00000000", status: "COMPUTED" });
    expect(calculate("win_rate", [{ numerator: "0", denominator: "2" }]).value).toBe("0.00000000");
  });
  it("rejects invalid contributions and numeric overflow", () => {
    for (const numerator of ["NaN", "Infinity", "-1", "10000000000000000"]) expect(() => calculate("mrr", [{ numerator, denominator: "0" }])).toThrow();
  });
  it("requires a tenant, valid calendar dates, supported version, and ordered exclusive bounds", () => {
    const valid = { organizationId: "org_a", from: "2026-08-01", to: "2026-09-01" };
    expect(requestSchema.parse(valid).version).toBe("1.0");
    for (const patch of [{ organizationId: "" }, { from: "2026-02-30" }, { to: "2026-08-01" }, { to: "2026-07-01" }, { version: "2.0" }]) expect(requestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});
