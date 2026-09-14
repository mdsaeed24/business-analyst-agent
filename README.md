# Business Analyst Agent

A portfolio analytics application built around realistic synthetic business data. Explore business performance, trace calculations to source records, investigate changes, and read or listen to AI-assisted explanations.

**Demo data only:** the included organizations, contacts, transactions and support records are synthetic. A real Stripe account is not required. The Stripe connector is implemented and tested with simulated provider responses; real-account synchronization is not verified.

**[Open the public demo](https://sayeed-business-analyst.streamlit.app/)** · [Source code](https://github.com/mdsaeed24/business-analyst-agent)

## Public Streamlit showcase

`streamlit_app.py` is a separate read-only companion for Streamlit Community Cloud. It shows validated July/August 2026 synthetic metric comparisons, charts, evidence summaries and deterministic investigation findings. It needs no database or API keys. The full Next.js application remains below and is not executed by Streamlit. Authentication, live sync, AI explanation generation and voice generation belong to that full application.

```sh
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run streamlit_app.py
python -m unittest discover -s tests -p 'test_streamlit_*.py'
```

Deploy on Streamlit Community Cloud with this repository, branch `main`, entrypoint `streamlit_app.py` and Python 3.14. Leave secrets empty. The committed `showcase/snapshot.json` contains aggregate synthetic values only. `npm run demo:export` can regenerate it from existing local synthetic July/August metric snapshots; it validates each snapshot against the TypeScript engine before exporting. It never exports users, credentials, raw source records, or live-tenant data.

Next.js App Router + TypeScript with PostgreSQL and Prisma. Includes validated synthetic ingestion, deterministic tenant-scoped metrics, authentication, investigations, optional DeepSeek explanations and ElevenLabs narration. Phase 8 adds a read-only Stripe billing connector and scheduled sync worker.

## Portfolio dashboard

The responsive dashboard includes Overview, Sales, Billing and Operations views, KPI change badges, accessible period-comparison charts and calculation evidence. Synthetic workspaces display a demo-data banner and hide live integration setup. July/August 2026 saved metrics load automatically after sign-in. The charts show saved period values, not fabricated daily trends; missing calculations remain visibly unavailable.

For a client walkthrough, open **Sales** to compare pipeline and win rate, select **View calculation** to inspect evidence, then open a saved **Investigation** for its AI explanation and voice player. Charts and navigation make no external API calls. Keep `LIVE_SYNC_ENABLED=false` and `STRIPE_SECRET_KEY=""` for the portfolio demo. DeepSeek and ElevenLabs are optional for generating new content; existing saved explanations/audio can still be reviewed.

## Local setup

Install Node.js 22.12+ (22 LTS recommended; `.nvmrc` provided) and provision an empty PostgreSQL database. Then:

```sh
npm ci
cp .env.example .env.local
# Replace DATABASE_URL placeholders in .env.local.
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

`DATABASE_URL` is the only required application variable. `NODE_ENV` is managed by Next.js. All configuration is server-only. Never put database URLs, API tokens, or other secrets in `NEXT_PUBLIC_` variables. `.env.local`, other environment files, keys, and secrets are ignored; `.env.example` contains placeholders only. Prisma CLI loads `.env.local` before `.env`, preserving existing process variables.

## Validation and deployment

```sh
npm run prisma:validate
npm run typecheck
npm test
npm run build
# With the target DATABASE_URL securely injected:
npm run prisma:deploy
npm start
```

Commit `package-lock.json` and `prisma/migrations/`. Use `prisma:migrate` only for development; deploy committed migrations with `prisma:deploy`. Client generation is included in build and typecheck. Build and liveness intentionally do not require database access. Runtime database configuration is validated when the database is first requested; readiness fails with a sanitized 503 if it is invalid.

- `GET /api/health/live`: uncached 200 while the process can handle requests.
- `GET /api/health/ready`: uncached 200 only after a real `SELECT 1`; otherwise sanitized 503. Connection and query timeouts are three seconds each. This verifies connectivity, not migration status.

## Structure

```text
src/app/                  App Router page, layout, and health routes
src/server/config/        Environment validation and server-only access
src/server/db/            Lazy, process-wide Prisma client and bounded pg pool
src/server/health/        Readiness response handling
src/generated/prisma/     Generated client (ignored)
prisma/                   Schema and committed SQL migrations
tests/                   Foundation tests
data/synthetic/          Original, unmodified CSV contents and dataset README
docs/                    Architecture and dataset notes
```

## Tenant boundaries

Organization is the tenant root. User is a global identity; Membership links a user to an organization with a role. Every other model includes a required `organizationId`. Composite foreign keys enforce tenant consistency between related records. Deletion is restricted to preserve financial and investigative history.

These constraints do **not** implement authorization or PostgreSQL row-level security. Before adding tenant data endpoints, authenticate callers, verify their membership, and scope every query/mutation to their organization. Never accept a caller-supplied organization ID without verifying membership. Tenant-scoped read endpoints require a valid session and organization membership. Investigation creation requires analyst, admin, or owner membership and a same-origin request.

Metric definitions are versioned per organization. Metric values use exact decimals and half-open periods `[periodStart, periodEnd)`; the migration requires the end to follow the start. Evidence can reference a same-tenant metric value and connection. Connection stores an environment variable name as its secret reference, never the credential value.

## Synthetic ingestion (Phase 2)

See [Phase 2 architecture, validation, counts, and commands](docs/phase-2.md).

After configuring local PostgreSQL and applying migrations:

```sh
npm run data:seed
npm run data:seed # Same persisted counts; idempotent upserts
```

Every row is validated and source/tenant identifiers are preserved. The command prints reconciliation counts and writes `reports/synthetic-ingestion.json`; invalid rows are reported with filenames and line numbers and cause a nonzero exit after valid rows finish. The data dictionary is validated as documentation; metric definitions are assigned only to organizations imported from these CSVs.

`npm run data:reset:synthetic` removes only explicitly marked synthetic rows and refuses production. Restrictive foreign keys protect non-synthetic dependent data and roll back a blocked reset.

`npm test` runs offline tests. Set `TEST_DATABASE_URL` explicitly to enable PostgreSQL integration tests, which use and clean up a new random schema.

## Deterministic metrics (Phase 3)

See [Phase 3 calculation rules, evidence, limitations, and validation](docs/phase-3.md).

```sh
npm run prisma:migrate
npm run metrics:compute -- --org org_northstar_001 --from 2026-08-01 --to 2026-09-01
```

Seed the dataset first. The end date is exclusive. All eight catalog metrics are calculated from normalized PostgreSQL records and persisted together with source snapshots. Percent metrics use a 0–100 scale; undefined ratios/averages return NO_DATA and null. Repeated computations update the existing organization/definition/period rows. Phase 4 exposes authenticated metrics and evidence endpoints.

## Authentication and dashboard (Phase 4)

See [Phase 4 setup, API contract, access controls and verification](docs/phase-4.md).

```sh
npm run prisma:migrate
npm run auth:create-user -- --email you@example.com --org org_northstar_001 --role OWNER
npm run dev
```

The account command securely prompts for a password in your terminal. Open http://localhost:3000, sign in, select your organization and period, and view the saved results. July/August comparisons and source evidence are supported. No public signup, OAuth, or email delivery is involved.

## Business investigations (Phase 5)

See [Phase 5 rules, saved evidence, API and validation](docs/phase-5.md). Sign in, choose a current and comparison period, and select **Investigate changes**. Findings use deterministic change rules and preserve original metric snapshots. Repeated unchanged inputs reopen the same saved investigation; analysts, admins and owners can create reports, and viewers can read them.

## Grounded AI explanations (Phase 6)

See [Phase 6 DeepSeek setup, privacy boundary, grounding and validation](docs/phase-6.md). Optional AI explanations use aggregate facts from saved investigations with evidence references. Configure the server-only DeepSeek key and enable flag, restart the app, and choose **Generate AI explanation**. Calculations remain deterministic; AI interpretations are labeled and saved separately.

## Voice playback (Phase 7)

See [Phase 7 ElevenLabs setup, narration, audio storage and validation](docs/phase-7.md). Completed explanations can be narrated on demand, cached, and played with an authenticated audio player. The exact transcript remains available. Configure the server-only ElevenLabs key, voice ID and enable flag to generate new audio.

## Stripe billing synchronization (Phase 8)

See [Phase 8 setup, worker commands, supported data and validation](docs/phase-8.md). Configure a read-only Stripe key and bind its account to a separate organization. The connector imports customers, subscription terms and charges, then polls events for changes. Dashboard controls queue work and show counts and run reports. Run `npm run sync:worker` to process queued and scheduled syncs. Existing synthetic metrics remain available; live billing metric definitions and automatic recalculation are a separate next step.
