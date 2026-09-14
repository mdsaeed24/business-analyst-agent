export const metricCatalog = {
  revenue_collected: { unit: "currency", table: "stripe_payments", formula: "sum(succeeded payment amount - refund amount), attributed to payment_date", mode: "sum" },
  mrr: { unit: "currency", table: "stripe_subscriptions", formula: "sum(MRR where start_date < end and cancel_date is null or >= end)", mode: "sum" },
  new_customers: { unit: "count", table: "stripe_customers", formula: "count(customer_since in period)", mode: "sum" },
  pipeline_created: { unit: "currency", table: "crm_deals", formula: "sum(amount for deals created in period, all stages)", mode: "sum" },
  win_rate: { unit: "percent", table: "crm_deals", formula: "100 * closed_won / (closed_won + closed_lost), by close_date", mode: "percent" },
  web_conversion_rate: { unit: "percent", table: "ga4_daily", formula: "100 * sum(conversions) / sum(sessions)", mode: "percent" },
  support_volume: { unit: "count", table: "support_tickets", formula: "count(tickets created in period, all statuses)", mode: "sum" },
  avg_first_response: { unit: "duration", table: "support_tickets", formula: "sum(first_response_minutes) / count(tickets created in period)", mode: "average" },
} as const;
export type MetricKey = keyof typeof metricCatalog;
export const ENGINE_VERSION = "1.0.0";
export const DEFINITION_VERSION = "1.0";
