# Phase 8 — Stripe billing synchronization

Stripe is the first live source selected for this phase. The implementation reads Stripe data into normalized PostgreSQL tables and provides a reusable worker, scheduling, leases, validation reports and dashboard controls. It does not deploy infrastructure, change Stripe objects, add other providers or automatically calculate metrics.

## Setup

Start with a Stripe test-mode account and a restricted key. In `.env.local`, add:

```dotenv
LIVE_SYNC_ENABLED=true
STRIPE_SECRET_KEY="YOUR_RESTRICTED_STRIPE_TEST_KEY"
```

Keep the existing database, DeepSeek and ElevenLabs settings. Never use `NEXT_PUBLIC_` for credentials. The database stores only the name `STRIPE_SECRET_KEY`; the browser cannot submit or read keys. See [Stripe's restricted-key instructions](https://docs.stripe.com/keys). Grant Read access to the resources used below; no Write permissions are needed. Depending on the dashboard grouping, subscription items are covered by Subscriptions and refunds by Charges and Refunds.

| Resource | Endpoints read |
| --- | --- |
| Account | `GET /v1/account` for account identity verification |
| Customers | list and retrieve customers |
| Subscriptions | list/retrieve subscriptions and list subscription items |
| Charges and Refunds | list/retrieve charges, including cumulative refunds |
| Invoices | retrieve charge invoice to identify its subscription |
| Events | list changes for incremental synchronization |

Use an account-scoped `rk_test_…` key and the matching `acct_…` account ID. Organization keys and Connect OAuth are not implemented. The reader also accepts standard secret keys, but a restricted read-only key is preferred. The first sync verifies account identity and mode; a permission failure produces `PROVIDER_ACCESS_DENIED` without returning Stripe's response body.

Apply migrations, then configure a separate organization with an existing application user's email. Replace the email and account ID placeholders:

```sh
npm run prisma:generate
npm run prisma:migrate
npm run sync:connect:stripe -- --org stripe_test --name "Stripe billing" --owner-email YOUR_LOGIN_EMAIL --account acct_YOUR_ACCOUNT_ID --mode test --timezone Asia/Kolkata
```

The command prints a connection ID. It creates the organization and grants that existing user OWNER membership. It refuses synthetic organizations, existing unowned source data, account/mode rebinding, and duplicate ownership of the same account/mode. Repeating setup updates the key reference and interval without duplicating the connection. Use `--secret-reference STRIPE_SECOND_KEY` for another account's environment variable and `--interval-minutes 60` to set the schedule interval (5–1440 minutes).

Run a full import, then repeat it to check the reported unchanged counts:

```sh
npm run sync:once -- --connection YOUR_CONNECTION_ID --full
npm run sync:once -- --connection YOUR_CONNECTION_ID --full
```

Restart the app to load environment settings, refresh the page, and select the new organization. In a separate terminal, run:

```sh
npm run sync:worker
```

The foreground worker checks for due work every 15 seconds. Scheduling starts disabled. Owners/admins can choose **Sync now**, **Queue full refresh**, or **Enable schedule**. **Refresh sync status** reloads counts and recent reports. `npm run sync:once` processes currently queued or due work once. Keep the worker running for scheduling; merely running Next.js does not process the queue. To pause automatic imports, disable the schedule. To stop all provider reads, stop the worker and set `LIVE_SYNC_ENABLED=false` before restarting it. Queued work remains in PostgreSQL.

## Architecture and consistency

- `src/lib/sync/http.ts`: bounded GET requests, timeouts, retry/backoff, response limits and sanitized failures.
- `src/lib/sync/stripe/`: pinned API client, explicit Zod projections, deterministic normalizers and dependency-safe full/incremental traversal.
- `src/lib/sync/store.ts`: tenant-scoped idempotent upserts and source ownership checks.
- `src/lib/sync/service.ts`: PostgreSQL advisory locks, expiring leases, heartbeat, run reports, checkpoints and due-work selection.
- `src/lib/sync/configure.ts`: trusted local account-to-organization provisioning.
- `src/lib/sync/api.ts` and `/api/connections`: authenticated tenant reads and same-origin owner/admin queue actions.
- `scripts/connect-stripe.ts`, `scripts/sync-worker.ts`: configuration and worker entry points.
- `src/components/connections.tsx`: existing dashboard integration.

The full import processes customers, all subscription statuses, then charges. Dependencies omitted from a list are fetched explicitly. Invoice reads provide subscription joins; invoices are not imported into QuickBooks tables. Pagination includes nested subscription items and validates cursors. The API version is pinned to `2024-06-20` so historical event versions do not control normalization.

Incremental imports list relevant events from the previous checkpoint with a five-minute overlap. They retrieve current objects rather than replay stale event payloads. A one-minute cutoff delay reduces boundary races. Stripe exposes events for [30 days](https://docs.stripe.com/api/events/list); checkpoints older than 27 days require a full refresh. This is eventual synchronization, not an atomic snapshot of Stripe. A full refresh reconciles previously imported customers missing from list results using explicit retrieval; confirmed deletions become tombstones.

Each row is validated before writing. Resource/page/row and safe error codes identify invalid records. Valid rows continue; reports retain at most 100 detailed issues plus the total issue count. A partial or failed run never advances its checkpoint. Retry safely reuses already persisted rows. No page checkpoint is stored for interrupted full imports: they restart from the beginning. Limits are 30 minutes per run, 10,000 reader requests, 1,000 pages per list and 1,000 items per subscription. Accounts exceeding those bounds need a future resumable backfill implementation.

Only the active lease owner can write. Expired leases can be recovered; an old worker cannot overwrite a new run's results. Source uniqueness includes organization/system/record ID, and composite foreign keys enforce tenant/customer/subscription consistency. Source hashes prevent unchanged records from changing `normalizedAt`; `ingestedAt` remains the first import time. `sourceObservedAt` records subsequent observations. Stripe objects lack a uniform updated timestamp, so `sourceUpdatedAt` remains null rather than using observation time as a fabricated source timestamp.

## Data semantics and limits

Stripe customer IDs, subscription IDs and charge IDs are preserved. Charges populate `StripePayment`; this is not a complete PaymentIntent ledger. Names, emails, addresses beyond country, card details and arbitrary metadata are discarded. Missing CRM/company relationships remain null. Deleted customer history is retained.

Original currency and integer minor amounts (original, captured, refunded) are stored. USD captures/refunds also populate the existing USD decimal fields; non-USD values remain null there. Subscription price components preserve quantity, decimal unit amount, interval, usage type and billing scheme without inventing a monthly revenue number. Live `monthlyRecurringRevenueUsd` remains null. Tiered/usage pricing, discounts, taxes, FX, prorations and accounting recognition are not calculated.

Existing synthetic metric definitions are not copied to live organizations. The metric source loader rejects unsupported null monetary inputs instead of silently interpreting them as zero. Saved metrics, investigations, AI explanations and audio are not automatically refreshed by a sync. The next step is versioned live billing metric definitions with explicit currency/MRR policies and deliberate recalculation/investigation scheduling.

## Schema and validation results

Migration: `prisma/migrations/20260914020000_stripe_sync/migration.sql`.

Added `SyncRun`/`SyncStatus`; extended `Connection` with scheduling, account mode, lease and checkpoint fields; extended the three Stripe models with connection lineage and actual billing fields; made unavailable source facts nullable. Billing/payment enums now cover Stripe statuses and payment methods. Organization gained the sync-run relation. Partial unique indexes enforce one configured Stripe connection per organization and one owner per account/mode.

Added `tests/sync.test.ts`, `tests/stripe-sync.test.ts`, `tests/stripe-sync.postgres.test.ts` and `tests/fixtures/stripe.ts`. Existing ingestion tests were adapted for nullable source fields. The full PostgreSQL suite passed all 81 tests: 63 offline and 18 database tests. Stripe fixtures imported two customers, one subscription and two payments; repeated imports retained exactly those counts. Tests cover refunds, cancellation, deletion history, malformed records, checkpoints, credentials/account/mode mismatch, pagination, retries, role/tenant isolation, scheduled processing and lease recovery. Integration tests use disposable schemas and mocked Stripe responses.

Run checks:

```sh
npm run prisma:generate
npm run prisma:migrate
npm run typecheck
npm test
npm run build
```

Set `TEST_DATABASE_URL` securely to enable PostgreSQL integration tests. Without it, database tests are explicitly skipped. The local migration has been applied. Real Stripe ingestion remains unverified until the key and account binding are configured; test fixture counts are not real-account import counts.
