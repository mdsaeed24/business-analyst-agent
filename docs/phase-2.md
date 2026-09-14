# Phase 2: normalized synthetic sources

Implemented ingestion only. No metrics are computed, no UI was redesigned, and no external API, OAuth, DeepSeek, ElevenLabs, or deployment integration was added.

## Model design

Added CRMCompany, CRMContact, CRMDeal, GA4DailyMetric, StripeCustomer, StripeSubscription, StripePayment, QuickBooksInvoice, QuickBooksExpense, and SupportTicket. Every CSV source column is retained with a camelCase field name. Organization gains industry and optional provenance; the existing MetricDefinition gains optional provenance and receives the CSV catalog. No MetricValue rows are created by ingestion.

All source models require organizationId, sourceSystem, sourceRecordId, sourceUpdatedAt, ingestedAt, and normalizedAt. Organization and metric definitions do not have source update timestamps in their CSVs, so sourceUpdatedAt remains null. Their sourceSystem is synthetic, with deterministic source IDs and actual import/normalization times. Organization.createdAt preserves the supplied created_at. Source-table timestamps retain the original CSV values. The initial ingestedAt is preserved on upsert; normalizedAt and other source fields can update on subsequent imports.

Every imported row is explicitly marked `syntheticDataset = business-analyst-synthetic-v1`. This is separate from sourceSystem: a synthetic Stripe record still has sourceSystem=stripe. Unmarked or differently marked records are never overwritten by this importer.

Business IDs are unique within each organization. Source identity is unique by organizationId + sourceSystem + sourceRecordId. GA4 also enforces one row per organization/source/date/channel. All parent references include organizationId, and payments reference the composite organization/customer/subscription key. QuickBooks customer IDs in this dataset deliberately reference StripeCustomer. CRM contacts and deals reference companies; there is no invented contact-to-deal relationship or global customer deduplication.

Money uses PostgreSQL NUMERIC(20,2), rates NUMERIC(7,6), and CSAT NUMERIC(3,2). Calendar dates use DATE and are parsed at UTC midnight; actual timestamps use TIMESTAMPTZ. Enums constrain source systems, lifecycle/deal stages, billing/payment/invoice/ticket statuses, payment methods, and ticket priorities. Indexes cover business/source identities, tenant/dependency keys, dataset reconciliation, and main date filters. Foreign keys use restrictive deletion.

Migration: `prisma/migrations/20260911010000_normalized_sources/migration.sql`. It adds the new tables and extends Organization/MetricDefinition without replacing Phase 1 tables.

## Architecture

- `src/lib/ingestion/catalog.ts`: static model/file registry, schemas, identifiers, and dependency order.
- `src/lib/ingestion/csv/read.ts`: CSV parsing and strict header validation, including BOM, quoted commas, escaped quotes, CRLF, and multiline fields.
- `src/lib/ingestion/schemas/`: Zod row validators and shared scalar parsers.
- `src/lib/ingestion/normalizers/record.ts`: deterministic field mapping, tenant assignment, provenance, and dataset marker.
- `src/lib/ingestion/pipeline.ts`: reusable store interface, per-row validation, same-import relationship checks, duplicate detection, tenant assignment, and reconciliation report.
- `src/lib/ingestion/prisma-store.ts`: Prisma idempotent upserts, ownership checks, savepoints, locking, counts, and restricted reset.
- `scripts/ingestion-runtime.ts`: dotenv precedence, validated database configuration, schema selection, client lifecycle, sanitized fatal errors.
- `scripts/seed-synthetic-data.ts` and `scripts/reset-synthetic-data.ts`: CLI entry points.

Import order: Organization → CRMCompany → CRMContact → CRMDeal → StripeCustomer → StripeSubscription → StripePayment → GA4DailyMetric → QuickBooksInvoice → QuickBooksExpense → SupportTicket → MetricDefinition.

The global metric catalog is assigned to every organization successfully imported from this dataset, never to arbitrary existing database tenants. The data dictionary is validated as a reference artifact and must describe every registered CSV exactly once; it is not an analytics source table and cannot select database operations.

## Validation and failure behavior

Every row passes a strict Zod schema before normalization/insertion. Required identifiers/text cannot be blank; emails, IANA timezones, currency/country formats, enums, ISO dates/timestamps, exact boolean strings, bounded nonnegative integers, decimal precision, and rate/CSAT ranges are checked. Blank optional dates, resolution times, currency, and CSAT map to null. Money remains a string until Prisma writes it as an exact decimal. Refund comparisons use integer cents. Closed-won flags must match stages; closed deals need close dates; cancellation and paid dates must match their statuses; close/cancel/due/paid date order is checked.

Missing same-tenant parents, unknown organizations, mismatched subscription customers, duplicate source/business IDs, and duplicate GA4 daily grain are rejected. Parent rows must have succeeded in this import; stale database parents cannot conceal malformed source files. Cross-source timing assumptions are deliberately not imposed: for example, the provided support records can predate customer_since. No values are recalculated from other source fields.

Each issue reports source filename, physical ending line number (including headers), category, useful field/relationship message, and tenant where available. Column-count errors reject only that row. Broken CSV quoting makes boundaries ambiguous, so that file is rejected and other files continue. Missing files and header errors are reported. Known database row constraint failures use savepoints and do not abort remaining rows. Unexpected infrastructure/runtime failures roll back the entire import and return a sanitized nonzero error.

A successful transaction commits valid rows even when other rows are rejected; the command then exits nonzero and writes `reports/synthetic-ingestion.json`. Rerun after correcting source records. The importer does not prune database records removed from CSVs: reconciliation exposes extra dataset rows, and the development reset can clear them. A transaction-scoped advisory lock serializes seed/reset commands. There is a 5-second lock wait and 10-minute import transaction limit; the complete synthetic dataset is intentionally small enough for this design.

Reports show CSV record counts, expected tenant-expanded counts, successful upsert counts, rejected attempts, persisted dataset/tenant counts, and exact-match flags. Successful upserts include existing rows, not only new inserts. CSV counts exclude headers; dictionary rows are not counted as imported entities. Generated reports are ignored by Git.

## Reset safety

`npm run data:reset:synthetic` rejects production and unknown NODE_ENV values (unset, development, and test are accepted). Seed uses the same guard. Reset deletes only rows with this exact dataset marker, in reverse dependency order, in one transaction. It never truncates tables or uses cascading deletes. Non-synthetic dependent rows block the operation and roll back every deletion. Non-synthetic organizations and records remain intact. This guard depends on correct environment configuration and is not a substitute for database permissions.

## Commands

Use Node.js compatible with package.json. Configure a real local PostgreSQL DATABASE_URL in `.env.local`; never commit credentials. The current local file contains a placeholder role, so replace it before using the default database. Injected environment variables take precedence; the optional `?schema=` URL parameter is honored by ingestion.

```sh
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run typecheck
npm test
npm run build
npm run data:seed
npm run data:seed
# Optional: delete only this synthetic dataset in development
npm run data:reset:synthetic
```

Unit tests run without PostgreSQL. To run PostgreSQL integration tests, set TEST_DATABASE_URL to a local test database whose role can create schemas, then run `npm test`. Tests create a random schema, apply the committed migrations inside it, and drop only that schema afterward. They never use DATABASE_URL as an implicit test target.

```sh
TEST_DATABASE_URL='postgresql://YOUR_ROLE@localhost:5432/YOUR_TEST_DATABASE' npm test
```

## Verification performed

Both migrations applied successfully to an isolated PostgreSQL test instance. The complete dataset imported with zero validation failures and matching counts; repeated imports preserved counts and source record IDs. Prisma generation, migration, typecheck, and production build passed. The final full suite passed all 26 tests (21 offline and 5 PostgreSQL integration tests; 17 tests added in Phase 2). Running without TEST_DATABASE_URL passes 21 and explicitly skips the 5 integration tests. The configured application database could not be used because its placeholder role `USER` does not exist; its configuration was left unchanged. Validation used a separate temporary database, not the application database.

| Model | CSV rows / persisted rows |
| --- | ---: |
| Organization | 1 |
| CRMCompany | 300 |
| CRMContact | 1,500 |
| CRMDeal | 908 |
| StripeCustomer | 465 |
| StripeSubscription | 465 |
| StripePayment | 4,914 |
| GA4DailyMetric | 3,648 |
| QuickBooksInvoice | 4,786 |
| QuickBooksExpense | 1,300 |
| SupportTicket | 2,341 |
| MetricDefinition | 8 |
| Total | 20,636 |

Tests cover the complete dataset, malformed and multiline CSV, invalid scalar values, duplicate inputs, repeated ingestion, two-tenant catalog assignment, missing/cross-tenant parents, mismatched subscription customers, database constraint recovery, ownership protection, production reset refusal, reset rollback, and preservation of non-synthetic rows.

Phase 3 should implement a deterministic, tenant-scoped metrics layer with explicit period/timezone/currency/status/refund semantics, versioned metric definitions, persisted MetricValue results and source evidence, and fixture-based correctness tests. Authentication/membership checks must precede tenant-facing data endpoints. No Phase 3 calculations were implemented here.

## Inspected CSV headers

- `crm_companies.csv`: `organization_id, source_system, source_record_id, company_id, company_name, industry, region, employee_count, annual_revenue_usd, lifecycle_stage, source_updated_at, ingested_at, normalized_at`
- `crm_contacts.csv`: `organization_id, source_system, source_record_id, contact_id, company_id, first_name, last_name, job_title, email, region, lifecycle_stage, created_date, source_updated_at, ingested_at, normalized_at`
- `crm_deals.csv`: `organization_id, source_system, source_record_id, deal_id, company_id, deal_name, stage, amount_usd, created_date, close_date, owner_id, pipeline, is_closed_won, source_updated_at, ingested_at, normalized_at`
- `data_dictionary.csv`: `file, primary_key, important_foreign_keys, purpose`
- `ga4_daily.csv`: `organization_id, source_system, source_record_id, date, channel, sessions, users, conversions, conversion_rate, bounce_rate, revenue_attributed_usd, source_updated_at, ingested_at, normalized_at`
- `metric_definitions.csv`: `metric_key, metric_name, definition, unit, source_tables, timezone, currency, version`
- `organizations.csv`: `organization_id, organization_name, industry, timezone, currency, created_at`
- `quickbooks_expenses.csv`: `organization_id, source_system, source_record_id, expense_id, expense_date, category, vendor, amount_usd, department, is_recurring, source_updated_at, ingested_at, normalized_at`
- `quickbooks_invoices.csv`: `organization_id, source_system, source_record_id, invoice_id, customer_id, invoice_date, due_date, amount_usd, status, paid_date, source_updated_at, ingested_at, normalized_at`
- `stripe_customers.csv`: `organization_id, source_system, source_record_id, customer_id, company_id, customer_since, status, country, source_updated_at, ingested_at, normalized_at`
- `stripe_payments.csv`: `organization_id, source_system, source_record_id, payment_id, customer_id, subscription_id, payment_date, amount_usd, status, payment_method, refund_amount_usd, source_updated_at, ingested_at, normalized_at`
- `stripe_subscriptions.csv`: `organization_id, source_system, source_record_id, subscription_id, customer_id, plan, monthly_recurring_revenue_usd, status, start_date, cancel_date, source_updated_at, ingested_at, normalized_at`
- `support_tickets.csv`: `organization_id, source_system, source_record_id, ticket_id, customer_id, created_at, priority, category, status, first_response_minutes, resolution_minutes, satisfaction_score, source_updated_at, ingested_at, normalized_at`

## File inventory

Created:

- `src/lib/ingestion/catalog.ts`
- `src/lib/ingestion/csv/read.ts`
- `src/lib/ingestion/schemas/primitives.ts`
- `src/lib/ingestion/schemas/records.ts`
- `src/lib/ingestion/normalizers/record.ts`
- `src/lib/ingestion/pipeline.ts`
- `src/lib/ingestion/prisma-store.ts`
- `scripts/ingestion-runtime.ts`
- `scripts/seed-synthetic-data.ts`
- `scripts/reset-synthetic-data.ts`
- `tests/ingestion.test.ts`
- `tests/ingestion.postgres.test.ts`
- `prisma/migrations/20260911010000_normalized_sources/migration.sql`
- `docs/phase-2.md`

Changed: `prisma/schema.prisma`, `package.json`, `package-lock.json`, `.gitignore`, and `README.md`. The generated Prisma client/build outputs were refreshed; the generated reconciliation report is ignored. All original CSVs remain unchanged.
