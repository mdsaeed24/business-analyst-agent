# Phase 7 — ElevenLabs narration and voice playback

Phase 7 adds on-demand text-to-speech for saved Phase 6 explanations, an authenticated audio player, and the exact narration text. This phase covers listening to investigations. Microphone input, conversational voice agents, voice cloning, live business-source integrations and deployment are not included.

## Setup

Keep your existing DATABASE_URL and DeepSeek configuration. Add server-only variables to `.env.local`:

```dotenv
ELEVENLABS_ENABLED="true"
ELEVENLABS_API_KEY="YOUR_ELEVENLABS_API_KEY"
ELEVENLABS_VOICE_ID="YOUR_AVAILABLE_VOICE_ID"
ELEVENLABS_MODEL="eleven_flash_v2_5"
```

Replace the key and voice placeholders with values from your ElevenLabs account. Choose a stock/library voice available to that account. No default identity, voice clone or sample upload is created. Do not share the key in chat, commit it, or prefix it with NEXT_PUBLIC_. Restart the app after configuration changes:

```sh
npm run dev
```

Sign in, open an investigation with a completed AI explanation, and find **Listen to this explanation**. Expand **Narration text** to preview what will be sent, then select **Prepare AI Briefing**. After generation, use the audio player's play, pause, volume and seek controls. **Stop audio** pauses and rewinds. There is no autoplay. Changing reports or signing out removes the player and stops playback.

Analysts, admins and owners can generate; all organization members can listen to already saved audio. Generation is disabled unless the enable flag, API key and voice ID are all configured. Cached audio remains playable when generation is disabled. A completed explanation is required; voice generation does not call DeepSeek to create one automatically.

## Data and provider boundary

The transcript is built from the saved explanation's qualitative interpretation and suggested checks plus numerical statements rebuilt from the original investigation evidence. Saved evidence IDs and verifiedStatement fields are not trusted as spoken facts: source snapshots and citations are validated again. Raw customer/contact/source records, IDs and credentials are not included in the narration request. No user-supplied text or arbitrary prompt is accepted by the API.

The narration begins by identifying itself as an AI voice reading an AI interpretation and verified statements, including the limitations of interpretations. The text remains visible because pronunciation of figures or technical terms can be imperfect. Audio is synthesized from the transcript; it does not replace or recalculate the underlying metrics. No semantic verification of spoken pronunciation is claimed.

The provider uses the fixed ElevenLabs text-to-speech endpoint, the configured voice ID, `eleven_flash_v2_5`, MP3 44.1 kHz/128 kbps, fixed stability/similarity settings, a 60-second timeout and no automatic retry. Redirects are rejected. Text is capped at 16,000 characters and audio at 16 MiB. Responses must have an audio/mpeg content type and plausible MP3 header/minimum length; this is a container sanity check, not a full decoder. Browser playback errors are shown explicitly.

Official references checked during implementation:

- [Create speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [Model documentation](https://elevenlabs.io/docs/overview/models)

Narration text is sent to ElevenLabs when generation is requested. The application does not claim provider zero retention or alter account retention settings; those depend on your ElevenLabs account/plan. API keys stay on the server. Neither provider error bodies nor keys are returned to clients or written to logs.

## Storage, limits and isolation

Migration `20260914010000_voice_narration` creates AudioNarration and NarrationStatus. Organization, Membership and Explanation gain relations; Explanation gains a composite organization/id unique key. Tenant-consistent foreign keys use restrictive deletion.

AudioNarration stores transcript/version, voice/model, hash, requesting membership, status, attempt/request identifiers, timestamps, sanitized error code, and the MP3 bytes in PostgreSQL BYTEA. The cache key covers transcript, version, voice, model, format and voice settings. Repeated identical generation uses the existing completed row; changing these inputs creates a new version. Metadata routes explicitly exclude binary data. The database-backed blob store is a bounded local implementation; production-scale storage and lifecycle management are future work.

A short tenant advisory-lock transaction claims generation and enforces uniqueness/limits. No transaction is held during the provider request. Requests are limited to ten new inputs per organization/hour and three attempts per input. Manual failed-request retries require a one-minute cooldown. An interrupted RUNNING request can be retried after three minutes. Completion rechecks membership/role and request ownership so a superseded request cannot overwrite newer audio. Provider calls may still incur cost if a client disconnects or a response fails validation.

All reads verify the current session, membership, organization, explanation and audio ID. Audio responses are private/no-store, with nosniff and a fixed filename. Single HTTP byte ranges support seeking; malformed, multiple or unsatisfiable ranges return 416. Each range request is authorized again. Previously received audio cannot be remotely revoked from a user's device; removing membership prevents subsequent reads.

## API

| Endpoint | Behavior |
| --- | --- |
| GET /api/explanations/:id/voice?organizationId=… | Member-only; generation availability, transcript preview and latest audio metadata. No provider call. |
| POST /api/explanations/:id/voice?organizationId=… | Same-origin analyst/admin/owner request; generates from saved evidence, or reuses cached audio. 201 new / 200 cached. |
| GET /api/explanations/:id/voice/:audioId?organizationId=… | Member-only MP3 retrieval; 200 full or 206 range response. |

Errors include 400 invalid identifiers, 401 unauthenticated, 403 membership/role/origin denial, 404 inaccessible explanation/audio, 409 incompatible evidence or in-progress/superseded request, 413 text limit, 416 invalid range, 429 request/provider limits, 502 provider/audio error, 503 missing/disabled configuration and 504 timeout. Deterministic findings and text remain available after generation errors.

## Files and verification

Created: `src/lib/voice/config.ts`, `transcript.ts`, `provider.ts`, `http.ts`, `service.ts`; `src/components/voice.tsx`; voice metadata/generation and audio routes under `src/app/api/explanations/[id]/voice/`; `tests/voice.test.ts`; the migration; and this document.

Changed: Prisma schema, explanation component, app styles, database integration tests, `.env.example`, README. No dependencies or secrets were added.

```sh
npm run prisma:generate
npm run prisma:migrate
npm run typecheck
npm test
npm run build
# Full integration suite in a disposable PostgreSQL schema:
TEST_DATABASE_URL='postgresql://YOUR_ROLE:YOUR_PASSWORD@localhost:5432/YOUR_TEST_DATABASE' npm test
```

Tests use mocked provider responses, never live billing credentials. They cover opt-in configuration, transcript integrity and privacy, malformed/oversized audio, limits/timeouts, byte ranges, concurrent repeat calls, persistence/caching, retry cooldown, binary read isolation and viewer generation restrictions. The integration suite also retains all prior ingestion, metric, authentication, investigation and explanation checks.

Final validation: the full suite passed 65 tests (54 offline and 11 PostgreSQL integration tests). After the final player/range refinements, all 54 offline tests, Prisma generation, typecheck and production build passed again. The additive migration is applied to the local application database. Browser verification in an isolated session decoded and played a three-second silent MP3 fixture, confirmed Stop rewound to zero, and displayed the transcript and disabled-generation message. The temporary account, narration, fixture and script were removed; existing reports/explanations were preserved. The local development server remains at http://localhost:3000. Live speech and pronunciation remain unverified because the ElevenLabs key and voice ID are not configured.
