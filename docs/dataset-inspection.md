# Initial inspection

The starting directory contained 13 CSV files and README.txt, with no application, UI, package manifest, tests, Git metadata, or AGENTS.md. The requested `data/synthetic/` path did not exist. Original files were relocated there without changing contents. Nothing was imported into a database.

| File | Data rows |
| --- | ---: |
| organizations.csv | 1 |
| crm_companies.csv | 300 |
| crm_contacts.csv | 1500 |
| crm_deals.csv | 908 |
| ga4_daily.csv | 3648 |
| stripe_customers.csv | 465 |
| stripe_subscriptions.csv | 465 |
| stripe_payments.csv | 4914 |
| quickbooks_invoices.csv | 4786 |
| quickbooks_expenses.csv | 1300 |
| support_tickets.csv | 2341 |
| metric_definitions.csv | 8 |
| data_dictionary.csv | 12 |

The fictional Northstar SaaS dataset spans January 2025 through August 2026, with USD currency and America/New_York timezone. Business source files carry organization_id, source_system, source_record_id, and source/ingestion/normalization timestamps. The metric catalog and data dictionary have no organization_id: Phase 2 must explicitly map metric definitions to their owning organization.

Join keys include organization_id, company_id, customer_id, and subscription_id. Tenant IDs must participate in joins; source IDs alone must not be assumed globally unique. Metric versions are strings such as `1.0`. Currency is optional for non-monetary metrics. Preserve these semantics when importing.

Seeded scenarios concern acquisition and conversion decline in July–August 2026, plus worsening support in August. Phase 1 does not calculate or assess these metrics.
