import * as schemas from "./schemas/records";

// Dependency order is part of the import contract. The dictionary is documentation,
// not executable metadata; it cannot choose database tables or fields.
export const catalog = [
  { file: "organizations.csv", model: "Organization", delegate: "organization", schema: schemas.organization, key: "id", parents: [] },
  { file: "crm_companies.csv", model: "CRMCompany", delegate: "cRMCompany", schema: schemas.company, key: "companyId", parents: [] },
  { file: "crm_contacts.csv", model: "CRMContact", delegate: "cRMContact", schema: schemas.contact, key: "contactId", parents: [{ model: "CRMCompany", field: "companyId" }] },
  { file: "crm_deals.csv", model: "CRMDeal", delegate: "cRMDeal", schema: schemas.deal, key: "dealId", parents: [{ model: "CRMCompany", field: "companyId" }] },
  { file: "stripe_customers.csv", model: "StripeCustomer", delegate: "stripeCustomer", schema: schemas.customer, key: "customerId", parents: [{ model: "CRMCompany", field: "companyId" }] },
  { file: "stripe_subscriptions.csv", model: "StripeSubscription", delegate: "stripeSubscription", schema: schemas.subscription, key: "subscriptionId", parents: [{ model: "StripeCustomer", field: "customerId" }] },
  { file: "stripe_payments.csv", model: "StripePayment", delegate: "stripePayment", schema: schemas.payment, key: "paymentId", parents: [{ model: "StripeCustomer", field: "customerId" }, { model: "StripeSubscription", field: "subscriptionId" }] },
  { file: "ga4_daily.csv", model: "GA4DailyMetric", delegate: "gA4DailyMetric", schema: schemas.ga4, key: "sourceRecordId", parents: [] },
  { file: "quickbooks_invoices.csv", model: "QuickBooksInvoice", delegate: "quickBooksInvoice", schema: schemas.invoice, key: "invoiceId", parents: [{ model: "StripeCustomer", field: "customerId" }] },
  { file: "quickbooks_expenses.csv", model: "QuickBooksExpense", delegate: "quickBooksExpense", schema: schemas.expense, key: "expenseId", parents: [] },
  { file: "support_tickets.csv", model: "SupportTicket", delegate: "supportTicket", schema: schemas.ticket, key: "ticketId", parents: [{ model: "StripeCustomer", field: "customerId" }] },
  { file: "metric_definitions.csv", model: "MetricDefinition", delegate: "metricDefinition", schema: schemas.metric, key: "key", parents: [] },
] as const;
export type Entry = (typeof catalog)[number];
export type Model = Entry["model"];
