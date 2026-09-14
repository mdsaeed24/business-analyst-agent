import { z } from "zod";
import { providerHttp, type FetchJson } from "../http";
import { SyncError } from "../errors";
import * as schemas from "./schemas";
export const STRIPE_API_VERSION = "2024-06-20";
export const EVENT_TYPES = ["customer.created", "customer.updated", "customer.deleted", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "charge.succeeded", "charge.failed", "charge.pending", "charge.updated", "charge.captured", "charge.refunded", "refund.created", "refund.updated", "refund.failed"];
export class StripeReader {
  requests = 0;
  constructor(private key: string, private liveMode: boolean, private http: FetchJson = providerHttp(), private beforeRequest: () => Promise<void> = async () => {}) {}
  async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    await this.beforeRequest();
    if (++this.requests > 10000) throw new SyncError("REQUEST_BUDGET_EXCEEDED");
    if (!/^\/(account|customers|subscriptions|charges|events|subscription_items|invoices)(\/[A-Za-z0-9_]+)?$/.test(path)) throw new SyncError("INVALID_RESOURCE_PATH");
    const url = new URL(`https://api.stripe.com/v1${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return this.http(url, { Authorization: `Bearer ${this.key}`, "Stripe-Version": STRIPE_API_VERSION });
  }
  async verify(accountId: string) {
    const account = z.object({ id: z.string().regex(/^acct_[A-Za-z0-9]+$/) }).parse(await this.get("/account"));
    if (account.id !== accountId) throw new SyncError("ACCOUNT_MISMATCH");
  }
  checkMode(raw: unknown) {
    const result = z.object({ livemode: z.boolean().optional(), deleted: z.boolean().optional() }).parse(raw);
    if (result.deleted !== true && result.livemode !== this.liveMode) throw new SyncError("MODE_MISMATCH");
  }
  async *pages(path: string, params: Record<string, string> = {}): AsyncGenerator<{ rows: unknown[]; page: number }> {
    let cursor: string | undefined; const seen = new Set<string>();
    for (let page = 1; page <= 1000; page++) {
      const parsed = schemas.page.parse(await this.get(path, { ...params, limit: "100", ...(cursor ? { starting_after: cursor } : {}) }));
      yield { rows: parsed.data, page };
      if (!parsed.has_more) return;
      const last = z.object({ id: z.string().regex(/^[A-Za-z]+_[A-Za-z0-9]+$/) }).safeParse(parsed.data.at(-1));
      if (!last.success || seen.has(last.data.id)) throw new SyncError("INVALID_PAGINATION");
      cursor = last.data.id; seen.add(cursor);
    }
    throw new SyncError("PAGE_LIMIT_EXCEEDED");
  }
  async completeSubscription(raw: unknown) {
    const parsed = schemas.subscription.parse(raw); this.checkMode(raw);
    if (!parsed.items.has_more) return parsed;
    const items: z.infer<typeof schemas.item>[] = [];
    for await (const page of this.pages("/subscription_items", { subscription: parsed.id })) {
      items.push(...page.rows.map((row) => schemas.item.parse(row)));
      if (items.length > 1000) throw new SyncError("SUBSCRIPTION_ITEM_LIMIT");
    }
    return { ...parsed, items: { data: items, has_more: false } };
  }
}
export function stripeCredential(reference: string | null, liveMode: boolean | null, env: Record<string, string | undefined> = process.env) {
  if (env.LIVE_SYNC_ENABLED !== "true") throw new SyncError("LIVE_SYNC_DISABLED");
  if (!reference || !/^STRIPE_[A-Z0-9_]*KEY$/.test(reference)) throw new SyncError("INVALID_SECRET_REFERENCE");
  const key = env[reference]?.trim();
  if (!key || !/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key)) throw new SyncError("STRIPE_KEY_MISSING_OR_INVALID");
  if (liveMode === null || key.includes("_live_") !== liveMode) throw new SyncError("MODE_MISMATCH");
  return key;
}
