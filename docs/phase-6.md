# Phase 6 — DeepSeek explanations grounded in saved evidence

Phase 6 adds optional AI explanations to completed investigations. Calculations, thresholds and evidence snapshots remain deterministic TypeScript/PostgreSQL results. DeepSeek produces qualitative interpretations and suggested checks; it does not ingest sources, calculate metrics, run tools/SQL, or modify source records or findings. Voice, live business-source integrations and deployment remain separate phases.

## Configure and use

Add these server-only variables to `.env.local`:

```dotenv
DEEPSEEK_ENABLED="true"
DEEPSEEK_API_KEY="YOUR_DEEPSEEK_API_KEY"
DEEPSEEK_MODEL="deepseek-flash"
```

Replace only `YOUR_DEEPSEEK_API_KEY` with your key from your DeepSeek account. Keep your existing DATABASE_URL and other configuration. Never use a NEXT_PUBLIC_ prefix, commit the key, or paste it into chat. An account with API access/balance is required for a live request. Restart the development server after changing configuration:

```sh
npm run dev
```

Sign in, create or reopen an investigation, and select **Generate AI explanation**. The screen explains that this sends aggregate metrics to DeepSeek. Analysts, admins and owners can generate; all organization members can read saved explanations. Unchanged model/prompt/evidence inputs reuse a saved explanation. If a request is running, reopen the investigation to refresh its status.

DeepSeek is disabled by default and requires both the enable flag and a nonempty key. The existing dashboard, investigations and cached explanations remain usable without a key. No live provider call was made during implementation because no key was configured.

## Integration and grounding

The provider uses the fixed `https://api.deepseek.com/chat/completions` endpoint, a server-only authorization header, non-thinking mode, JSON output, temperature zero, a 2,000-token output cap, a 30-second timeout, and a 64 KiB response cap. Redirects are rejected. No SDK dependency was needed. Supported configured model IDs are `deepseek-flash` and `deepseek-v4-pro`, matching the official documentation checked during implementation:

- [Chat completions API](https://api-docs.deepseek.com/api/create-chat-completion/)
- [JSON output guide](https://api-docs.deepseek.com/guides/json_mode/)

The grounding layer validates the investigation version, period parameters, tenant ownership and original copied metric snapshots. It independently reproduces saved values from their contribution terms, then runs the existing deterministic change rules. The outbound payload is an explicit projection of aggregate values, changes, states, thresholds, fixed follow-up suggestions, reporting dates and known limitations. Raw sources, customer/contact names, emails, tickets, source identifiers, tenant IDs, free-form questions, dictionary text and arbitrary source text are excluded.

Zod validates model output as one to eight unique insights with valid references to the supplied evidence. Unsupported fields, duplicate/unknown references, numeric digits, currency/percent symbols, HTML delimiters and web links in prose are rejected. Actual numerical statements and database evidence IDs are attached by the application after validation, not supplied by the model. Model content is rendered as plain React text, never executable Markdown/HTML.

These checks constrain structure and attribution; they cannot prove every natural-language interpretation is true. The UI labels the content as AI-generated and advises checking it against the saved evidence. Suggested checks are proposals, and observed changes do not establish causes. Temperature zero does not guarantee deterministic language output; durable caching provides repeatability for accepted results.

## Persistence and request lifecycle

Migration `20260913020000_explanations` adds Explanation and ExplanationStatus. Organization, Investigation and Membership gain relation fields. Composite tenant foreign keys restrict access relationships; deletion remains restrictive. Existing data is preserved.

Each explanation stores its organization, investigation, requesting membership, model, prompt version, input hash, lifecycle state, attempt count, request identity, timestamps, sanitized error code and validated content. The unique organization/investigation/input-hash key prevents duplicate saved results. Changing the model, prompt version or evidence projection creates a new row; existing explanations remain stored.

A short transaction takes a tenant advisory lock to check permissions, deduplicate requests, enforce limits and claim work. No database transaction remains open during HTTP. Concurrent unchanged requests either receive the cache or a 409 while one request runs. Completion checks both the request identity and current membership/role; an expired lease cannot overwrite a newer attempt. Crashed requests become eligible for retry after two minutes. Failures preserve deterministic findings and are recorded without provider bodies or secrets.

No automatic provider retry occurs. A manual retry has a one-minute cooldown and a maximum of three attempts per unique input. At most twenty new explanation inputs per organization per hour can be created. These are basic cost controls, not a deployment-wide billing system. Requests may still incur provider cost if the caller disconnects or a response fails validation.

## API

| Endpoint | Behavior |
| --- | --- |
| GET /api/investigations/:id/explanation?organizationId=… | Authenticated tenant member; availability, configured model and latest saved explanation/status. No provider call. |
| POST /api/investigations/:id/explanation?organizationId=… | Same-origin authenticated analyst/admin/owner; uses only saved evidence. No arbitrary prompt accepted. 201 new or 200 cached. |

Errors: 400 invalid identifiers, 401 unauthenticated, 403 role/tenant/origin denial, 404 inaccessible investigation within an assigned tenant, 409 incompatible evidence or in-progress/superseded request, 429 cooldown/attempt/organization/provider limit, 502 unavailable/invalid provider response, 503 disabled/missing configuration, 504 provider timeout. Responses are no-store and unexpected failures are sanitized.

## Files and validation

Created:

- `src/lib/explanations/config.ts`, `grounding.ts`, `provider.ts`, `service.ts`
- `src/app/api/investigations/[id]/explanation/route.ts`
- `src/components/explanation.tsx`
- `tests/explanations.test.ts`
- `prisma/migrations/20260913020000_explanations/migration.sql`
- `docs/phase-6.md`

Changed: Prisma schema, investigations UI, PostgreSQL integration tests, `.env.example`, README. No secrets or new dependencies were added.

```sh
npm run prisma:generate
npm run prisma:migrate
npm run typecheck
npm test
npm run build
# Optional full suite in a disposable schema, using your test database credentials:
TEST_DATABASE_URL='postgresql://YOUR_ROLE:YOUR_PASSWORD@localhost:5432/YOUR_TEST_DATABASE' npm test
```

Provider tests use injected fetch responses and database tests inject a mock generator. No real credentials, network calls or provider charges are required. Tests cover optional configuration, payload minimization, injection-text exclusion, evidence integrity, output/citation rejection, request limits, malformed/truncated/oversized responses, timeouts, sanitized errors, durable caching, concurrent calls, failed-attempt cooldown and retries, tenant isolation, and viewer restrictions.

Final validation: 57 tests passed with PostgreSQL enabled (46 offline, 11 integration tests). The final offline run passed 46 and explicitly skipped the 11 opt-in database tests. Prisma generation, local migration, typecheck and production build passed. Browser verification covered cached mocked content, AI labeling, verified evidence disclosure and the disabled-generation state. The temporary analyst account, mocked explanation, sessions and throttle row were removed; an existing user-created investigation was preserved. The local server was restarted and remains at http://localhost:3000. Live DeepSeek generation remains unverified until DEEPSEEK_API_KEY and DEEPSEEK_ENABLED are configured.
