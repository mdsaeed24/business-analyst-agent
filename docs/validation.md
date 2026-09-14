# Phase 1 validation

- Dependencies installed and locked with npm 11 after bundled npm 10 failed internally during dependency resolution.
- Prisma client generation and schema validation passed (Prisma 7.10.0).
- Initial SQL migration generated from the schema, with an additional metric-period CHECK constraint.
- Typecheck passed.
- All 9 foundation tests passed, covering invalid/missing configuration, sanitized failures, liveness, and readiness handling.
- Production build passed (Next.js 16.3.4).
- Production HTTP smoke test: liveness returned 200 and readiness returned a sanitized 503 without DATABASE_URL; both responses set Cache-Control: no-store.
- All 14 relocated dataset files matched the supplied ZIP archive byte-for-byte.

No PostgreSQL service or DATABASE_URL was available. The migration has not been applied to a live PostgreSQL server, and database-connected readiness and foreign-key enforcement still need integration verification against that server. Unit tests exercise the readiness success/failure behavior with a supplied database check.

## Dependency audit follow-up

The installation audit and `npm audit --omit=dev` both report four high-severity package findings: `prisma`, `@prisma/config`, `deepmerge-ts`, and `mysql2`. They trace to the Prisma tooling dependency tree. Do not assume that omitting development dependencies removes them: Prisma is also pulled through package peer relationships.

The reported issues concern recursive graph merging in deepmerge-ts and MySQL protocol handling in mysql2. This application uses PostgreSQL and does not expose Prisma tooling or accept user-provided Prisma configuration. Nevertheless, the audit is not clean and needs resolution before a production release. npm's suggested automatic fix changes the Prisma major version; no unverified major downgrade or forced transitive override was applied. Reassess a patched Prisma release or validated dependency overrides, then rerun the migration and application checks.

The temporary Node.js/npm installation used for verification is outside the repository. Install Node.js normally before using the documented commands in a fresh shell.
