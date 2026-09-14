# Phase 3 — deterministic metrics

Phase 3 implements the eight version 1.0 metric definitions already loaded by Phase 2. It reads normalized PostgreSQL tables, uses exact decimal arithmetic, and persists tenant-scoped MetricValue records with calculation evidence. No LLM, live API, OAuth, audio, deployment, investigation workflow, or UI redesign is included.

## Run locally

Configure a real local PostgreSQL `DATABASE_URL` in `.env.local`, then:

```sh
npm run prisma:generate
npm run prisma:migrate
npm run data:seed
npm run metrics:compute -- --org org_northstar_001 --from 2026-08-01 --to 2026-09-01
npm run typecheck
npm test
npm run build
```

The end date is exclusive. The example computes August 2026. The CLI prints the eight results and writes `reports/metrics.json`. Full evidence is in `MetricValue.calculationDetails`. Repeating the same command updates the same eight rows instead of creating duplicates. Reports are ignored by Git.

Set `TEST_DATABASE_URL` to enable integration tests; they create and remove their own random schema, including migrations and synthetic fixtures. They never use the application database implicitly.

```sh
TEST_DATABASE_URL='postgresql://YOUR_ROLE@localhost:5432/YOUR_TEST_DATABASE' npm test
```

The default local configuration still contains the placeholder role `USER`. Validation therefore uses the separate temporary PostgreSQL instance from Phase 2; default application credentials remain untouched.

## Calculation contract

Every request requires an explicit organization ID and valid ordered calendar dates. Version 1.0 is the only supported metric definition version. Definitions must exist in that organization and have the expected source table, unit, and currency. USD source columns cannot be reported as another currency, and no currency conversion occurs. All eight results commit together in a serializable transaction; any failure rolls back the batch. A concurrent serialization conflict can be retried by rerunning the idempotent command.

Each metric uses its definition's IANA timezone. PostgreSQL resolves local midnight to actual instants, including daylight-saving changes. TIMESTAMPTZ sources use those instants; DATE sources use the supplied calendar labels directly. Persisted periodStart/periodEnd are the timezone-resolved instants. All interval filters are `[start, end)`.

| Key | Exact behavior |
| --- | --- |
| revenue_collected | Sum amount minus refund amount for succeeded payments with payment_date in the period. Failed payments are excluded. Refunds are attributed to the original payment date because no refund event date exists. |
| mrr | Sum stored monthly recurring amounts for subscriptions started before the exclusive end, with no cancellation date or cancellation on/after that end. This is the snapshot immediately before the end boundary; a subscription canceled later still contributes to an earlier period. |
| new_customers | Count customer_since dates in the period, regardless of current status. |
| pipeline_created | Sum amounts for deals created in the period, regardless of stage. |
| win_rate | 100 × closed_won / (closed_won + closed_lost), selected by close_date. Open stages are excluded. |
| web_conversion_rate | 100 × sum(conversions) / sum(sessions) across all selected days/channels. Stored daily rate values are not averaged. |
| support_volume | Count tickets created in the period, regardless of status. |
| avg_first_response | Sum first_response_minutes divided by selected ticket count; output is minutes. |

Percent values are percentage points: `2.97830680` means 2.97830680%, not a fraction. Arithmetic uses a private Decimal configuration with 60-digit precision, rounds only the final value to eight decimal places using half-up rounding, and rejects values exceeding NUMERIC(24,8). Monetary inputs never pass through JavaScript floating-point arithmetic.

Empty additive metrics are numeric zero. Ratios/averages with zero denominator have status NO_DATA and null value. The migration enforces status/value consistency, preserving existing numeric results as COMPUTED. A zero result only means zero matching normalized records; it does not establish ingestion completeness or verified business inactivity.

## Persistence and evidence

The existing unique organization/definition/period key remains the identity of each result. MetricValue adds status, engineVersion, inputHash, calculationDetails, and syntheticDataset, and permits a null value for NO_DATA. Existing Phase 1 values remain compatible. Migration: `20260912010000_deterministic_metrics`.

Evidence includes the implemented formula, definition text/version, date labels, timezone, units/currency, numerator/denominator, source count, known limitations, and selected source snapshots. Snapshots include tenant, internal/business/source IDs, source system, source update/ingestion/normalization timestamps, and the actual date/status/amount/count inputs used. Names, emails, and irrelevant source fields are not copied. A SHA-256 hash identifies the ordered calculation input snapshot. Repeating a computation on unchanged data preserves IDs and input hashes; computedAt records the latest run.

Results are the latest computation per version and period, not an append-only run history. Their evidence remains a snapshot even if source records later change, until explicitly recomputed. The metrics service does not fabricate investigations to store evidence; existing EvidenceItem relations remain unchanged. Future audit-history work can introduce immutable computation runs if required. Calculation rule changes require an explicit definition-version change and matching implementation/tests.

All queries and writes include organization ownership. This internal service and trusted local CLI are not authentication or authorization. No new HTTP data endpoint is exposed. Future tenant-facing endpoints must verify membership before invoking the service.

Derived values are marked synthetic only when both their definition and all contributing rows belong to the known synthetic dataset. The Phase 2 reset now deletes those marked derived values before definitions, still inside its restrictive transaction. Unmarked metric values and dependent evidence continue to block unsafe deletion.

## Data limits

Historical MRR uses the current stored plan amount and start/cancel dates; the source has no plan-change event history. Historical refunds are similarly attached to payment_date. Current deal stages and source snapshots do not provide a complete historical change log. These are explicit source limitations, not inferred missing values. No revenue or expense totals from additional systems are invented, and no business health score or anomaly detection is implemented.

## Files

Created:

- `src/lib/metrics/catalog.ts`: supported keys, units, formulas and engine version.
- `src/lib/metrics/calculate.ts`: pure exact arithmetic and null/overflow rules.
- `src/lib/metrics/period.ts`: request validation and timezone-aware boundaries.
- `src/lib/metrics/sources.ts`: typed tenant/date-scoped source selection and input snapshots.
- `src/lib/metrics/service.ts`: transactional calculation, evidence hashing and persistence.
- `scripts/compute-metrics.ts`: CLI and JSON report.
- `tests/metrics.test.ts`: arithmetic and input tests.
- `prisma/migrations/20260912010000_deterministic_metrics/migration.sql`.
- `docs/phase-3.md`.

Changed: Prisma schema, package.json, README.md, synthetic ingestion/reset adapter, database client configuration, CLI database runtime, and the PostgreSQL integration test suite. Source CSVs and UI remain unchanged.

## August 2026 reference results

Independently cross-checked using Python Decimal and CSV data, with America/New_York timestamp boundaries:

| Metric | Result |
| --- | ---: |
| Revenue collected | USD 594,411.43 |
| MRR | USD 609,558.00 |
| New customers | 12 |
| Pipeline created | USD 169,985.31 |
| Win rate | 48.48484848% |
| Web conversion rate | 2.97830680% |
| Support volume | 207 |
| Average first response | 36.35748792 minutes |

Tests cover exact decimals, refund subtraction, weighted conversion rates, rounding and overflow, missing denominators, invalid periods, all eight full-dataset expectations, persisted idempotency, source-hash changes, spring/fall DST, exclusive interval boundaries, failed payments, historical subscription cancellation, tenant isolation, atomic failure, and compatibility with the synthetic reset.

## Validation results

Prisma generation, migration, typecheck, build, and all 36 tests passed against the isolated PostgreSQL instance (27 offline tests and 9 database tests; 10 tests added for Phase 3). The metrics CLI ran twice and retained exactly eight result rows. SQL verification confirmed August boundaries at `2026-08-01 04:00:00 UTC` and `2026-09-01 04:00:00 UTC`. The default database remains blocked by placeholder credentials.

Database testing exposed a non-UTC timestamp decoding issue in the installed Prisma adapter. Period boundaries now use epoch milliseconds, and ingestion/calculation transactions and database client sessions explicitly use UTC for timestamp encoding and decoding. DST and exact source-inclusion tests verify the correction independently of the server timezone.
