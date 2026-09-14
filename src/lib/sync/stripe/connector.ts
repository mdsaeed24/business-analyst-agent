import { SyncError } from "../errors";
import { StripeReader, EVENT_TYPES } from "./client";
import * as schema from "./schemas";
export type Resource = "customers" | "subscriptions" | "payments";
export type Issue = { resource: string; page: number; row: number; code: string };
export type Sink = { write: (resource: Resource, raw: unknown, subscriptionId?: string | null) => Promise<void>; issue: (issue: Issue) => void; heartbeat: () => Promise<void>; knownCustomerIds: () => Promise<string[]> };
export async function importStripe(reader: StripeReader, sink: Sink, cutoff: Date, watermark: Date | null) {
  const customers = new Set<string>(), subscriptions = new Set<string>(), charges = new Set<string>();
  async function customer(raw: unknown) {
    reader.checkMode(raw); const row = schema.customer.parse(raw);
    await sink.write("customers", row); customers.add(row.id);
  }
  async function ensureCustomer(id: string) { if (!customers.has(id)) await customer(await reader.get(`/customers/${schema.customerId.parse(id)}`)); }
  async function subscription(raw: unknown) {
    const row = await reader.completeSubscription(raw);
    await ensureCustomer(row.customer); await sink.write("subscriptions", row); subscriptions.add(row.id);
  }
  async function ensureSubscription(id: string) { if (!subscriptions.has(id)) await subscription(await reader.get(`/subscriptions/${schema.subscriptionId.parse(id)}`)); }
  async function charge(raw: unknown) {
    reader.checkMode(raw); const row = schema.charge.parse(raw);
    if (charges.has(row.id)) return;
    if (row.customer) await ensureCustomer(row.customer);
    let subscriptionId: string | null = null;
    if (row.invoice) {
      const invoice = schema.invoice.parse(await reader.get(`/invoices/${row.invoice}`));
      if (invoice.customer !== row.customer) throw new SyncError("INVOICE_CUSTOMER_MISMATCH");
      if (invoice.subscription) { await ensureSubscription(invoice.subscription); subscriptionId = invoice.subscription; }
    }
    await sink.write("payments", row, subscriptionId); charges.add(row.id);
  }
  async function safely(resource: string, page: number, row: number, work: () => Promise<void>) {
    await sink.heartbeat();
    try { await work(); } catch (error) {
      if (error instanceof SyncError && ["ACCOUNT_MISMATCH", "MODE_MISMATCH", "LEASE_LOST", "RUN_TIME_LIMIT", "REQUEST_BUDGET_EXCEEDED", "PROVIDER_ACCESS_DENIED", "PROVIDER_BUSY", "PROVIDER_UNREACHABLE"].includes(error.code)) throw error;
      sink.issue({ resource, page, row, code: error instanceof SyncError ? error.code : "INVALID_RECORD_OR_RELATIONSHIP" });
    }
  }
  if (watermark) {
    if (cutoff.getTime() - watermark.getTime() > 27 * 86400000) throw new SyncError("FULL_SYNC_REQUIRED_EVENT_GAP");
    const params: Record<string, string> = { "created[gte]": String(Math.max(0, Math.floor(watermark.getTime() / 1000) - 300)), "created[lt]": String(Math.floor(cutoff.getTime() / 1000)) };
    EVENT_TYPES.forEach((type, i) => { params[`types[${i}]`] = type; });
    for await (const page of reader.pages("/events", params)) for (const [i, raw] of page.rows.entries()) await safely("events", page.page, i + 1, async () => {
      const event = schema.event.parse(raw); reader.checkMode(event);
      // Event payload versions vary. Retrieve the current object using the pinned
      // API version instead of applying stale or differently shaped event data.
      if (event.type.startsWith("customer.subscription.")) await ensureSubscription(schema.subscriptionId.parse(event.data.object.id));
      else if (["customer.created", "customer.updated", "customer.deleted"].includes(event.type)) await ensureCustomer(schema.customerId.parse(event.data.object.id));
      else if (event.type.startsWith("charge.") || event.type.startsWith("refund.")) {
        const id = schema.chargeId.parse(event.type.startsWith("refund.") ? event.data.object.charge : event.data.object.id);
        if (!charges.has(id)) await charge(await reader.get(`/charges/${id}`));
      } else throw new SyncError("UNEXPECTED_EVENT_TYPE");
    });
  } else {
    const params = { "created[lt]": String(Math.floor(cutoff.getTime() / 1000)) };
    for (const [resource, path, apply] of [["customers", "/customers", customer], ["subscriptions", "/subscriptions", subscription], ["payments", "/charges", charge]] as const) {
      for await (const page of reader.pages(path, { ...params, ...(resource === "subscriptions" ? { status: "all" } : {}) })) for (const [i, raw] of page.rows.entries()) await safely(resource, page.page, i + 1, () => apply(raw));
    }
    // A full refresh also retrieves previously imported customers absent from
    // list results, preserving confirmed deleted tombstones without guessing.
    for (const [i, id] of (await sink.knownCustomerIds()).entries()) if (!customers.has(id)) await safely("customer_reconciliation", 1, i + 1, () => ensureCustomer(id));
  }
}
