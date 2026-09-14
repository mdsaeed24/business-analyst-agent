import { describe, expect, it } from "vitest";
import { StripeReader, stripeCredential } from "../src/lib/sync/stripe/client";
import { normalizeCustomer, normalizeSubscription, normalizeCharge, businessDate } from "../src/lib/sync/stripe/normalize";
import { customerA, subscriptionA, chargeA, fakeStripe } from "./fixtures/stripe";
const context = { organizationId: "org", connectionId: "conn", timezone: "America/New_York", now: new Date("2026-09-14T00:00:00Z") };
describe("Stripe normalization and pagination", () => {
  it("preserves nullable associations and missing business facts", () => {
    const row = normalizeCustomer(customerA, context);
    expect(row.companyId).toBeNull(); expect(row.status).toBeNull(); expect(row.sourceUpdatedAt).toBeNull();
    expect(JSON.stringify(row)).not.toContain("not-imported");
    expect(row.customerSince?.toISOString()).toBe("2026-07-31T00:00:00.000Z");
    expect(businessDate(1772947800, "UTC")).toBeInstanceOf(Date);
  });
  it("preserves captured amounts and original currencies without fake USD conversions", () => {
    const usd = normalizeCharge({ ...chargeA, amount_captured: 9000, amount_refunded: 500 }, null, context);
    expect(usd.amountUsd).toBe("90.00"); expect(usd.refundAmountUsd).toBe("5.00"); expect(usd.amountMinor).toBe(10000n);
    const euro = normalizeCharge({ ...chargeA, customer: null, invoice: null, currency: "eur" }, null, context);
    expect(euro.amountUsd).toBeNull(); expect(euro.customerId).toBeNull(); expect(euro.currency).toBe("EUR");
    expect(() => normalizeCharge({ ...chargeA, amount_refunded: 10001 }, null, context)).toThrow();
  });
  it("preserves billing terms and fingerprints actual dates", () => {
    const row = normalizeSubscription(subscriptionA, context);
    expect(row.monthlyRecurringRevenueUsd).toBeNull();
    expect(JSON.stringify(row.billingComponents)).not.toContain("private");
    const first = normalizeSubscription({ ...subscriptionA, status: "canceled", ended_at: 1788220800 }, context);
    const second = normalizeSubscription({ ...subscriptionA, status: "canceled", ended_at: 1788307200 }, context);
    expect(first.sourceHash).not.toBe(second.sourceHash);
  });
  it("rejects arbitrary secret references and test/live mismatches", () => {
    expect(() => stripeCredential("DATABASE_URL", false, {})).toThrow("LIVE_SYNC_DISABLED");
    expect(() => stripeCredential("DATABASE_URL", false, { LIVE_SYNC_ENABLED: "true" })).toThrow("INVALID_SECRET_REFERENCE");
    expect(() => stripeCredential("STRIPE_SECRET_KEY", true, { LIVE_SYNC_ENABLED: "true", STRIPE_SECRET_KEY: "rk_test_fixture" })).toThrow("MODE_MISMATCH");
  });
  it("paginates nested items and does not follow untrusted URLs", async () => {
    const f = fakeStripe(), reader = new StripeReader("test", false, f.http);
    const row = await reader.completeSubscription({ ...subscriptionA, items: { ...subscriptionA.items, has_more: true } });
    expect(row.items.data).toHaveLength(2); expect(row.items.has_more).toBe(false);
    await expect(reader.get("https://attacker.example")).rejects.toThrow("INVALID_RESOURCE_PATH");
  });
  it("rejects repeated page cursors and account mismatches", async () => {
    const reader = new StripeReader("test", false, async () => ({ object: "list", data: [{ id: "cus_A" }], has_more: true }));
    await expect((async () => { for await (const _ of reader.pages("/customers")) { /* exhaust */ } })()).rejects.toThrow("INVALID_PAGINATION");
    await expect(new StripeReader("test", false, fakeStripe().http).verify("acct_Wrong")).rejects.toThrow("ACCOUNT_MISMATCH");
  });
});
