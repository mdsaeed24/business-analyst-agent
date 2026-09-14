# Phase 4 — authenticated analytics and dashboard

Implemented local email/password authentication, expiring database sessions, organization membership checks, tenant-scoped read APIs, period comparisons, and a dashboard connected to saved metric values and evidence. No live integrations, OAuth, LLM, audio, deployment, or new business metric formulas were added.

## Create your account and start the app

The authentication migration is applied to your configured local database. July and August 2026 metric results are already saved. Create your own account with a real email identifier (no email is sent):

```sh
npm run auth:create-user -- --email you@example.com --org org_northstar_001 --role OWNER
npm run dev
```

The account command prompts for a password and confirmation without displaying either. Passwords must contain 12–128 characters. Use an interactive terminal; passwords are not accepted as command-line arguments. Existing accounts are not silently overwritten, and an organization must already exist. The default role is VIEWER when --role is omitted. This is an administrator CLI intended for someone already trusted with database access, not a public signup endpoint.

Open `http://localhost:3000`, sign in, choose an organization and reporting period, and select **View results**. Enable **Compare periods** to compare saved periods; choose **View evidence** for the source snapshot and calculation details. Sign out revokes the active session and clears displayed data.

For a new installation:

```sh
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run data:seed
npm run metrics:compute -- --org org_northstar_001 --from 2026-07-01 --to 2026-08-01
npm run metrics:compute -- --org org_northstar_001 --from 2026-08-01 --to 2026-09-01
npm run auth:create-user -- --email you@example.com --org org_northstar_001 --role OWNER
npm run dev
```

## Authentication and authorization

Passwords are salted and hashed with Node.js scrypt using N=131072, r=8, p=1, following the [OWASP scrypt configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt). Verification uses timing-safe comparison and runs the same key derivation when an account/hash is missing. Passwords and session tokens are never stored in plaintext in PostgreSQL.

A successful login creates a 32-byte random session token, stores only its SHA-256 hash, and sets an HttpOnly, SameSite=Strict cookie. Cookies are Secure in production. Sessions have an absolute eight-hour lifetime. Login rotates the presented session, expired sessions for that user are cleaned up, and logout deletes the session. Expired, missing and forged tokens are rejected. User passwords are nullable only for compatibility with existing Phase 1 identity rows; those users cannot password-login until explicitly provisioned.

A database-backed per-email counter permits ten login attempts per fifteen-minute window, including successful attempts. Unknown accounts receive the same credential error. Failed validation is rejected before database work; login request bodies are limited to 4096 bytes. Login/logout require Origin to match the incoming Host and protocol. The Host comparison handles Next.js normalizing its internal request hostname; arbitrary forwarded-host headers are not trusted. Deployment behind a proxy must preserve the original Host and correct protocol. This phase does not add public registration, password reset, MFA, email verification, or an internet-facing deployment.

Every analytics request authenticates the session and checks the requested organization's Membership. Organization listings contain only assigned tenants. All roles may read their own organization's metrics and evidence; no tenant write/recompute endpoint exists. Changing or removing membership takes effect on subsequent reads. A forged organization ID is denied even with a valid session, and an evidence ID is looked up with organizationId rather than by global ID alone. Authentication/session/throttle tables are global identity infrastructure, not tenant-owned analytics rows.

No-store responses apply to all authentication and analytics success/error responses. Raw driver messages, credentials, password hashes and session hashes are not returned to clients. Source details remain accessible only through authenticated, authorized requests.

## API contract

| Endpoint | Behavior |
| --- | --- |
| POST /api/auth/login | Same-origin JSON email/password; sets session cookie; generic invalid-credential response. |
| POST /api/auth/logout | Same-origin; revokes cookie session and clears cookie; idempotent. |
| GET /api/organizations | Lists organizations and roles for the current session's user. |
| GET /api/metrics | Requires organizationId, from and to (exclusive); optional compareFrom/compareTo pair. Returns eight version 1.0 metric slots and comparison data. |
| GET /api/metrics/:id/evidence | Requires organizationId; returns authorized source evidence, input hash, engine version and calculation time. |

Status codes: 400 invalid inputs, 401 missing/expired session or bad credentials, 403 invalid origin or unassigned organization, 404 metric not present in an authorized organization, 413 oversized login body, 429 login limit, and sanitized 500 for unexpected failures. Existing public liveness/readiness routes remain unchanged.

## Saved periods and comparisons

Read APIs never recompute metrics or write metric results. Dates are matched against the exact timezone-resolved saved period for each metric definition. Missing definitions/results return NOT_COMPUTED and null; stored undefined ratios return NO_DATA. Neither is represented as zero. July and August both use the Phase 3 deterministic calculations.

Comparison returns the saved baseline, absolute delta, delta unit, and relative percent change. Percent metrics use percentage-point deltas. A missing value makes the delta unavailable; a zero baseline makes relative percent change null while the absolute delta can still be calculated. Relative change preserves decreases as negative values. Arithmetic remains exact on the server; the UI formats values to two decimal places for readability and displays absolute/percentage-point deltas without assigning a good/bad business interpretation.

The dashboard offers organization/date selectors, comparison controls, eight result cards, loading/error/empty states, evidence disclosure, and sign-out. Changing organizations or dates clears prior results; late responses are discarded to avoid displaying a response for superseded selections. Evidence shows the saved formula, timezone, source count, aggregates, known limitations, source records and input fingerprint. It does not call an LLM or execute formulas from stored text.

## Schema and files

Migration `20260912020000_authentication` adds User.passwordHash, Session and LoginThrottle. It does not rewrite or delete existing source/metric data. Session deletion cascades only when its owning user is deliberately deleted; synthetic reset still cannot delete an organization with user memberships.

Created:

- `src/lib/auth/password.ts`, `src/lib/auth/service.ts`
- `src/lib/analytics/http.ts`, `src/lib/analytics/service.ts`
- `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`
- `src/app/api/organizations/route.ts`, `src/app/api/metrics/route.ts`
- `src/app/api/metrics/[id]/evidence/route.ts`
- `src/components/dashboard.tsx`
- `scripts/create-user.ts`
- `tests/auth.test.ts`
- `prisma/migrations/20260912020000_authentication/migration.sql`
- `docs/phase-4.md`

Changed: Prisma schema, package.json, README.md, app page/layout/styles, server database client (honors the configured schema), and PostgreSQL integration tests. Next.js generated AGENTS.md and CLAUDE.md when starting its development server. CSVs and existing metric calculation formulas remain unchanged.

## Validation

```sh
npm run prisma:generate
npm run typecheck
npm test
npm run build
TEST_DATABASE_URL='postgresql://YOUR_ROLE@localhost:5432/YOUR_TEST_DATABASE' npm test
```

Database integration tests create and remove a fresh random schema, never reset existing application data. Tests cover password hashing, invalid credentials, token hashing/expiry, secure cookie settings, origin checks including local hostname normalization, uncached sanitized errors, per-account rate limits, membership revocation, cross-tenant metric/evidence access, missing results, zero-baseline comparisons, negative relative changes, and all preceding ingestion/metric tests.

Browser verification used a temporary VIEWER account to sign in, load all eight August cards, open revenue source evidence, display unavailable comparison data, load July comparisons after computation, and sign out. The temporary account, membership, throttle record and sessions were removed afterward. No permanent user account or password was chosen on your behalf.

Next development work can add administrator membership/account management and recovery, then richer investigation workflows on top of the deterministic evidence. Live integrations and deployment remain separate work.

Final results: all 41 tests passed (31 offline, 10 PostgreSQL integration tests). Prisma generation, migration, typecheck and production build passed. Browser checks confirmed login, eight metric cards, source evidence, unavailable and available comparisons, and logout. The additive migration is applied to the local application database; July and August results are saved. Temporary UI credentials were revoked and the test server was stopped.
