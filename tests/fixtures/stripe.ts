import type { FetchJson } from "../../src/lib/sync/http";
export const created = 1785542400;
export const customerA = { id: "cus_A", object: "customer", created, livemode: false, address: { country: "US" }, email: "not-imported@example.com", name: "Private name" };
export const customerB = { ...customerA, id: "cus_B", address: null };
export const priceItem = { id: "si_A", quantity: 2, price: { id: "price_A", currency: "usd", unit_amount_decimal: "1234.5", billing_scheme: "per_unit", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" }, transform_quantity: null, metadata: { private: "not-imported" } } };
export const subscriptionA = { id: "sub_A", object: "subscription", customer: "cus_A", livemode: false, created, start_date: created, status: "active", currency: "usd", ended_at: null as number | null, cancel_at_period_end: false, items: { data: [priceItem], has_more: false } };
export const chargeA = { id: "ch_A", object: "charge", customer: "cus_A" as string | null, livemode: false, created, amount: 10000, amount_captured: 10000, amount_refunded: 0, currency: "usd", status: "succeeded", invoice: "in_A" as string | null, payment_method_details: { type: "card", card: { last4: "4242" } } };
export function event(type: string, id: string, index = 1) { return { id: `evt_${index}`, type, created: Math.floor(Date.now() / 1000) - 120, livemode: false, data: { object: { id } } }; }
export function fakeStripe() {
  const state = { account: "acct_Test", customers: [structuredClone(customerA), structuredClone(customerB)] as unknown[], subscription: structuredClone(subscriptionA), charges: [structuredClone(chargeA), { ...structuredClone(chargeA), id: "ch_Guest", customer: null, invoice: null, currency: "eur" }], events: [] as unknown[], calls: [] as string[], extraItems: false };
  const page = (data: unknown[], has_more = false) => ({ object: "list", data, has_more });
  const http: FetchJson = async (url) => {
    state.calls.push(url.pathname + url.search);
    switch (url.pathname) {
      case "/v1/account": return { id: state.account };
      case "/v1/customers": return page(state.customers.filter((r) => !(r as { deleted?: boolean }).deleted));
      case "/v1/customers/cus_A": return state.customers[0];
      case "/v1/customers/cus_B": return state.customers[1];
      case "/v1/subscriptions": return page([{ ...state.subscription, items: { ...state.subscription.items, has_more: state.extraItems } }]);
      case "/v1/subscriptions/sub_A": return state.subscription;
      case "/v1/subscription_items": return url.searchParams.has("starting_after") ? page([{ ...priceItem, id: "si_B" }]) : page([priceItem], true);
      case "/v1/charges": return page(state.charges);
      case "/v1/charges/ch_A": return state.charges[0];
      case "/v1/invoices/in_A": return { id: "in_A", object: "invoice", customer: "cus_A", subscription: "sub_A" };
      case "/v1/events": return page(state.events);
      default: throw new Error("Unexpected fixture route");
    }
  };
  return { state, http };
}
