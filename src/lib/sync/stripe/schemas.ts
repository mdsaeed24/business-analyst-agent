import { z } from "zod";
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`));
export const customerId = id("cus"), subscriptionId = id("sub"), chargeId = id("ch");
const seconds = z.number().int().nonnegative().max(253402300799);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reference = (schema: z.ZodString) => z.union([schema, z.object({ id: schema }).transform((v) => v.id)]);
export const customer = z.discriminatedUnion("deleted", [
  z.object({ id: customerId, object: z.literal("customer"), deleted: z.literal(true) }),
  z.object({ id: customerId, object: z.literal("customer"), deleted: z.literal(false).optional(), created: seconds, livemode: z.boolean(), address: z.object({ country: z.string().regex(/^[A-Z]{2}$/).nullable() }).nullable().optional() }),
]);
export const item = z.object({
  id: id("si"), quantity: z.number().int().nonnegative().nullable().optional(),
  price: z.object({ id: id("price"), currency: z.string().regex(/^[a-z]{3}$/), unit_amount_decimal: z.string().regex(/^\d+(\.\d+)?$/).nullable(), billing_scheme: z.enum(["per_unit", "tiered"]), recurring: z.object({ interval: z.enum(["day", "week", "month", "year"]), interval_count: z.number().int().positive(), usage_type: z.enum(["licensed", "metered"]) }).nullable(), transform_quantity: z.object({ divide_by: z.number().int().positive(), round: z.enum(["up", "down"]) }).nullable().optional() }),
});
export const subscription = z.object({
  id: subscriptionId, object: z.literal("subscription"), customer: reference(customerId), livemode: z.boolean(), created: seconds, start_date: seconds,
  status: z.enum(["active", "canceled", "trialing", "past_due", "unpaid", "incomplete", "incomplete_expired", "paused"]),
  currency: z.string().regex(/^[a-z]{3}$/), ended_at: seconds.nullable(), cancel_at_period_end: z.boolean(),
  items: z.object({ data: z.array(item), has_more: z.boolean() }),
});
export const charge = z.object({
  id: chargeId, object: z.literal("charge"), customer: reference(customerId).nullable(), livemode: z.boolean(), created: seconds,
  amount: minor, amount_captured: minor, amount_refunded: minor, currency: z.string().regex(/^[a-z]{3}$/), status: z.enum(["succeeded", "failed", "pending"]),
  invoice: reference(id("in")).nullable().optional(), payment_method_details: z.object({ type: z.string().regex(/^[a-z_]{1,80}$/) }).nullable(),
}).refine((r) => r.amount_refunded <= r.amount_captured && r.amount_captured <= r.amount, "Inconsistent captured/refunded amounts");
export const invoice = z.object({ id: id("in"), object: z.literal("invoice"), customer: reference(customerId), subscription: reference(subscriptionId).nullable() });
export const event = z.object({ id: id("evt"), created: seconds, livemode: z.boolean(), type: z.string(), data: z.object({ object: z.object({ id: z.string(), charge: reference(chargeId).nullable().optional() }) }) });
export const page = z.object({ object: z.literal("list"), has_more: z.boolean(), data: z.array(z.unknown()).max(100) });
