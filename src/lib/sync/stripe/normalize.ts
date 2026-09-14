import { Prisma } from "../../../generated/prisma/client";
import * as schemas from "./schemas";
import { fingerprint } from "../../investigations/analyze";
export type Context = { organizationId: string; connectionId: string; timezone: string; now: Date };
export function businessDate(seconds: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(seconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
}
function lineage(context: Context, id: string, fields: object) {
  return { organizationId: context.organizationId, sourceConnectionId: context.connectionId, sourceRecordId: id, sourceSystem: "stripe" as const, sourceHash: fingerprint(JSON.parse(JSON.stringify(fields))), syntheticDataset: null, sourceUpdatedAt: null, sourceObservedAt: context.now, ingestedAt: context.now, normalizedAt: context.now };
}
export function normalizeCustomer(raw: unknown, context: Context) {
  const r = schemas.customer.parse(raw);
  const fields = { customerId: r.id, companyId: null, status: null, country: r.deleted ? null : r.address?.country ?? null, customerSince: r.deleted ? null : businessDate(r.created, context.timezone), sourceCreatedAt: r.deleted ? null : new Date(r.created * 1000), sourceDeletedAt: r.deleted ? context.now : null };
  return { ...fields, ...lineage(context, r.id, { ...fields, sourceDeletedAt: Boolean(r.deleted) }) };
}
export function normalizeSubscription(raw: unknown, context: Context) {
  const r = schemas.subscription.parse(raw);
  if (r.items.has_more) throw new Error("Subscription items must be fully paginated");
  const fields = { subscriptionId: r.id, customerId: r.customer, plan: r.items.data.map((i) => i.price.id).sort().join(",") || "no-price-items", status: r.status, monthlyRecurringRevenueUsd: null, startDate: businessDate(r.start_date, context.timezone), cancelDate: r.ended_at === null ? null : businessDate(r.ended_at, context.timezone), cancelAtPeriodEnd: r.cancel_at_period_end, currency: r.currency.toUpperCase(), billingComponents: r.items.data as unknown as Prisma.InputJsonValue, sourceCreatedAt: new Date(r.created * 1000), sourceDeletedAt: null };
  return { ...fields, ...lineage(context, r.id, fields) };
}
export function normalizeCharge(raw: unknown, subscriptionId: string | null, context: Context) {
  const r = schemas.charge.parse(raw), usd = (amount: number) => new Prisma.Decimal(amount).div(100).toFixed(2);
  const fields = { paymentId: r.id, customerId: r.customer, subscriptionId, paymentDate: businessDate(r.created, context.timezone), currency: r.currency.toUpperCase(), amountMinor: BigInt(r.amount), capturedAmountMinor: BigInt(r.amount_captured), refundedAmountMinor: BigInt(r.amount_refunded), amountUsd: r.currency === "usd" ? usd(r.amount_captured) : null, refundAmountUsd: r.currency === "usd" ? usd(r.amount_refunded) : null, status: r.status, paymentMethod: r.payment_method_details?.type === "card" ? "card" as const : r.payment_method_details?.type === "us_bank_account" || r.payment_method_details?.type === "ach_debit" ? "ach" as const : "other" as const, paymentMethodType: r.payment_method_details?.type ?? null, invoiceSourceId: r.invoice ?? null, sourceCreatedAt: new Date(r.created * 1000), sourceDeletedAt: null };
  return { ...fields, ...lineage(context, r.id, { ...fields, amountMinor: String(r.amount), capturedAmountMinor: String(r.amount_captured), refundedAmountMinor: String(r.amount_refunded) }) };
}
