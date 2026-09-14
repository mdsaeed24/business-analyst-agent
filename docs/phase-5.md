# Phase 5 — deterministic business investigations

The dashboard can compare saved metrics, flag material changes using explicit rules, show arithmetic contributors, and save findings with the original evidence. The implementation uses TypeScript decimal arithmetic. No external APIs, language models, audio, OAuth, or deployment are included.

## Use it

The migration is applied to the configured local database. Start the app if it is not already running:

```sh
npm run dev
```

Open http://localhost:3000 and sign in with your existing account. Select Northstar SaaS and August 2026, enable **Compare periods**, and choose July 2026. End dates are exclusive. Select **Investigate changes**. Analyst, admin, and owner roles can create investigations; viewers can read saved history and evidence. Repeat the action to reopen the same report when inputs have not changed. History shows the latest 20 reports.

For another checkout/database, run:

```sh
npm run prisma:generate
npm run prisma:migrate
npm run data:seed
npm run metrics:compute -- --org org_northstar_001 --from 2026-07-01 --to 2026-08-01
npm run metrics:compute -- --org org_northstar_001 --from 2026-08-01 --to 2026-09-01
npm run dev
```

Investigations consume saved calculations; they do not refresh source data or recompute metrics. Recompute the affected periods after ingestion changes, then run the investigation again. Existing account setup remains documented in Phase 4.

## Rules and evidence

| Metric | Absolute change threshold |
| --- | --- |
| Revenue collected, MRR, new customers, pipeline created, support volume, average first response | 20% relative to baseline |
| Win rate | 5 percentage points |
| Web conversion rate | 0.5 percentage points |

Thresholds are inclusive, compare unrounded decimal changes, and require at least ten source records in both periods. These are configurable-in-code business rules, not statistical significance tests or proof of causation. The rule version is saved with each report. Neither increases nor decreases are automatically described as good or bad.

Dates must be valid, non-overlapping, with the baseline before the current period, and each period at most 366 calendar days. Missing saved metrics, undefined ratios, small samples, zero baselines, and incompatible comparisons have explicit states. Flow totals of unequal calendar duration are not automatically flagged. MRR is a point-in-time measure; rates and averages can compare unequal durations. Reporting timezones must match. Known Phase 3 source limitations carry forward.

Each finding includes up to five contributors and a remainder that reconciles to the total delta. Payment, subscription, customer, deal, or ticket identifiers identify records; win rate groups by outcome and web conversion groups by channel. Rate/average contributions divide each group's numerator by the total denominator for its period. They include changes in mix and denominator and must not be interpreted as isolated causal effects.

Expected July-to-August 2026 synthetic flags: pipeline created decreases, win rate decreases, support volume increases. The other five metrics fall below their rules.

## Storage and API

Migration `20260913010000_investigations` extends the existing Investigation model with nullable engineVersion, inputHash, parameters, and findings fields, preserving legacy records. A unique organizationId/inputHash index enforces repeat-run uniqueness. The existing EvidenceItem model and composite tenant foreign keys store one evidence item per available metric pair.

The service verifies snapshot metadata, tenant identities, supported versions, and recomputes source contribution totals to confirm each saved value. An incompatible snapshot returns 409 with instructions to recompute. At least one complete saved metric pair is required. Findings and copied current/baseline snapshots commit atomically in a serializable transaction. Concurrent identical runs retry conflicts and return the same investigation. Canonical JSON hashing ignores object-key order while including the exact inputs, snapshots and investigation version.

Later metric recomputation does not change the copied report evidence. Changed inputs create a new investigation; unchanged inputs reuse the original, including its creator. Synthetic reset remains blocked by saved investigative history and memberships through restrictive foreign keys.

| Endpoint | Contract |
| --- | --- |
| POST /api/investigations | Same-origin authenticated JSON: organizationId, from, to, compareFrom, compareTo. Requires ANALYST/ADMIN/OWNER. 201 new; 200 reused. |
| GET /api/investigations?organizationId=… | All member roles; latest 20 summaries for that tenant. |
| GET /api/investigations/:id?organizationId=… | All member roles; tenant-scoped findings and original snapshots. |

400 invalid input, 401 unauthenticated, 403 insufficient role/membership or invalid origin, 404 unavailable report, 409 missing/incompatible evidence, 413 body over 4096 bytes. Responses are uncached and unexpected errors are sanitized.

## Files and verification

Created: `src/lib/investigations/analyze.ts`, `src/lib/investigations/service.ts`, `src/app/api/investigations/route.ts`, `src/app/api/investigations/[id]/route.ts`, `src/components/investigations.tsx`, `tests/investigations.test.ts`, the migration, and this document.

Changed: Prisma schema, dashboard component, app styles, PostgreSQL integration tests, README. Existing source CSVs and metric formulas are unchanged.

```sh
npm run prisma:generate
npm run prisma:migrate
npm run typecheck
npm test
npm run build
# Optional database suite; creates/removes only a fresh random schema:
TEST_DATABASE_URL='postgresql://YOUR_ROLE:YOUR_PASSWORD@localhost:5432/YOUR_TEST_DATABASE' npm test
```

Tests cover input validation, exact thresholds, missing/undefined values, sample guards, zero baselines, duration/timezone mismatch, denominator changes, contribution reconciliation, snapshot integrity, stable fingerprints, concurrent idempotency, immutable evidence after recomputation, changed-input versioning, tenant isolation, and role enforcement.

Final validation: all 49 tests passed (38 offline and 11 PostgreSQL integration tests). Prisma generation, the additive local migration, typecheck, and production build passed. Browser checks confirmed creating eight findings with the expected three flags, reusing the same report on repeat, opening original evidence, and expanding a contributor breakdown. The temporary analyst account, sessions, throttle row, and test reports were removed. The local development server was restarted to load the generated Prisma schema and remains available at http://localhost:3000. No blockers remain.
