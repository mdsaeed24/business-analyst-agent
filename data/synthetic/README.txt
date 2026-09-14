BUSINESS ANALYST SYNTHETIC DATASET

Fictional company: Northstar SaaS
Period: 2025-01-01 to 2026-08-31
Currency: USD
Timezone: America/New_York

This is completely synthetic data. It contains no real people, customers, transactions, or company information.

SEEDED BUSINESS STORY
1. July-August 2026: new sales opportunities fall.
2. July-August 2026: new Stripe customers fall.
3. July-August 2026: website conversion rates fall by about 20%.
4. August 2026: support volume spikes and response/resolution times get worse.

These anomalies are deliberate. Your Business Analyst agent should be able to detect them, calculate metrics from code/SQL, and explain the evidence.

JOIN MAP
organization_id -> all tenant-owned tables
company_id -> crm_companies + crm_contacts + crm_deals + stripe_customers
customer_id -> stripe_customers + stripe_subscriptions + stripe_payments + quickbooks_invoices + support_tickets
subscription_id -> stripe_subscriptions + stripe_payments

RECOMMENDED FIRST QUESTIONS
- How is the business doing in August 2026?
- Why did revenue growth weaken?
- What changed in customer acquisition?
- Did website conversion deteriorate?
- Is customer support getting worse?
- Which evidence best explains the health-score decline?
