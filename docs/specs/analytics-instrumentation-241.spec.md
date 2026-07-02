# Feature Spec — Complementary analytics-instrumentation agent (issue #241)

Status: **frozen** (2026-07-02). Lane: full. Owner: Haider.

## 1. Summary & precedence contract

A **complementary, coding-first** capability. When a feature is built and analytics
instrumentation is **enabled**, paqad also wires the project's analytics tracking for that
feature — on top of a correct build, using the project's own convention, separably, and
degradably. Coding correctness is never traded for tracking; analytics failing is a 🟡,
never a 🔴 on the feature.

Every tag the agent writes is recorded to the paqad ledger on the shared session-ledger
substrate, exactly like stage-evidence / rag-evidence — script-written, never
LLM-authored. **Recording and reading are both script-driven, and recording is gated on
the analytics flag being enabled** (owner decision, 2026-07-02, overriding the issue's
"always-on regardless of flag": if the agent is off it writes no tags, so there is nothing
to record; when on, every tag it writes lands a row automatically).

## 2. Enablement (authorization axis)

- One persisted opt-in flag `analytics_instrumentation` (default **OFF**), registered in
  `FRAMEWORK_CONFIG_SPECS` (`src/core/framework-config.ts`), group `app`, env
  `PAQAD_ANALYTICS_INSTRUMENTATION`, mirrored into `ProjectFeatureFlags`
  (`src/core/types/project-profile.ts`) + resolver + serializer + `CONFIG_KEY_SECTIONS`.
- `.mjs` hooks read it via `readLayeredKey(root, 'analytics_instrumentation',
  'PAQAD_ANALYTICS_INSTRUMENTATION')` in `runtime/hooks/lib/paqad-disabled.mjs`.
- Detection **informs** ("could we, and how?"); the flag **authorizes** ("are we allowed?").
  OFF always wins and OFF is silent — a detected provider with the flag off produces no
  code, no row, no suggestion.

## 3. Detection (read-only, from the codebase)

- `src/detection/signals/analytics-provider.ts` (new), exported from
  `src/detection/index.ts`, merged into `Detector.runDetect()`, persisted with confidence
  into `.paqad/detection-report.json` as `DetectionSignal[]`.
- **Layer 1 (provider):** deps (`@segment/analytics-next`, `posthog-js`,
  `mixpanel-browser`, `@amplitude/analytics-browser`, `react-ga4`, `@vercel/analytics`,
  `plausible-tracker`, `analytics`), HTML/entry (`googletagmanager.com/gtag`, `G-XXXXXXX`,
  GTM container), env keys (`NEXT_PUBLIC_POSTHOG_KEY`, `SEGMENT_WRITE_KEY`, `*_ANALYTICS_*`).
- **Layer 2 (convention):** call-site scan (`posthog.capture(`, `gtag('event'`,
  `mixpanel.track(`, `analytics.track(`) — defines the naming convention. Highest-confidence
  signal wins; call sites break ties.
- Pure inference. Zero write authority.

## 4. Classifier tag + pipeline carry (token-frugal gate)

- `ClassificationResult` (`src/core/types/classification.ts`) gets an additive optional
  `analytics_tag?: AnalyticsTagDecision` (mirrors `retrieval_needed?`).
- Net gate, resolved cheapest-first at classify time, short-circuit:
  1. flag OFF ⇒ tag = `off`, stop (do not even detect); 2. change not feature-shaped ⇒ `n/a`,
  stop; 3. no provider detected ⇒ `dormant`; else ⇒ `instrument` with the detected provider.
- Carried forward via a sidecar `.paqad/planning/analytics-decision.json` the later stages
  read (same pattern as the feature-spec sidecar), so there is no second analysis pass.

## 5. Ledger — `paqad.analytics-tag` (the emphasized part)

New module `src/analytics-tag/`, a faithful mirror of `src/rag-ledger/`:

- `types.ts` — `ANALYTICS_TAG_DOC_TYPE='paqad.analytics-tag'`, `ANALYTICS_TAG_SCHEMA_VERSION=1`,
  `kind: 'open' | 'tag_added'`, `AnalyticsTagRow` (envelope + `conversation_ordinal`,
  `adapter`, `tag_name`, `tag_provider`, `source_path`, `note`), and the fold shape.
- `schema.ts` — AJV, `additionalProperties:false`, `doc_type` const, every field in
  `required`/`properties`, `validateAnalyticsTagRow`. In `src/`, never under `.paqad/`.
- `recorder.ts` — `resolveSessionId` (reused from `@/rag-ledger/session.js`) + `openSessionDoc`
  + `appendSessionEvent`. **Best-effort (try/catch → null)** like rag/decision-reuse (a
  tag-add is a hot path; a recorder failure must never break the edit). Redacts `note`.
- `fold.ts` — `foldAnalyticsTagSession` over `readSessionDoc` (script-driven read).
- `marker-parse.ts` — regex `^[ \t>*-]*paqad:analytics-tag\s+<name>[\s+<provider>[\s+<path>]]\s*$`,
  `parseAndRecordAnalyticsTags` reading only assistant text, de-duping against existing rows.
- `registry.ts` — fold rows → the tracking-map table (see §8).
- `index.ts` — barrel.

## 6. Invocation seams (script-driven, provider-honest, flag-gated)

- **Claude live tier:** `runtime/hooks/analytics-tag-writer.mjs` (PreToolUse mutation) —
  thin drain-stdin → `isPaqadDisabled` guard → **flag guard** → lazy-import
  `dist/analytics-tag/live-writer.js` → scan the mutated file's new content against the
  detected convention → record `tag_added` for NEW tag call-sites (idempotent vs the
  ledger) → exit 0. Registered in `PAQAD_LIVE_HOOKS` (`src/adapters/shared/paqad-hooks.ts`).
- **Claude completion + Codex/Gemini record tier:** parse `paqad:analytics-tag` transcript
  markers — a new completion hook `analytics-tag-marker-parse.mjs` for Claude, and folded
  into `verification-record.mjs` (adapter via `argv[2]`) for Codex/Gemini (#265 tier). Host
  stamped as `adapter`; record-only, no in-chat verdict on non-Claude hosts.
- Every seam **no-ops when the flag is OFF** and when paqad is disabled.

## 7. Conflict → Decision Pause (closed list)

Add analytics categories to `DECISION_CATEGORIES` + `DECISION_CATEGORY_DEFAULTS`
(`src/planning/decision-packet.ts`): `analytics.provider_version_mismatch`,
`analytics.taxonomy_violation`, `analytics.pii_consent`, `analytics.no_provider_flag`,
`analytics.architecture_conflict`. Everything else: instrument correctly + show the
one-line summary. Surfaced via the Decision Pause Contract (AskUserQuestion on claude-code).

## 8. Tracking-map registry

`docs/instructions/registries/analytics-tracking-map.md` — a **generated** table (one row
per tag: feature/journey, event(s), provider, call site, convention) derived from
`paqad.analytics-tag` rows via `readAllSessionRows`/`foldByOrdinal`, plus a hand-authored
"how analytics is used here" convention preamble that reconcile preserves. Header marks the
generated/hand-owned split. CLI `analytics-map reconcile` runs the fold→rewrite; the seam
also refreshes it on tag write. `analytics-tag show` prints the per-session fold.

## 9. SIEM

Include `ANALYTICS_TAG_DOC_TYPE` in `SESSION_LEDGER_DOC_TYPES` (`src/audit/aggregate.ts`)
with a `sessionDetail`/`sessionVerdict` formatter — tag writes are audit-relevant (unlike
rag-evidence/decision-reuse, which are deliberately excluded).

## 10. Deferred (own follow-up tickets, not blockers)

- Distinct globally-unique `conversation_id` — ship with `session_id` + `conversation_ordinal`
  composite key (both already on the row).
- Setting up a provider from scratch when none exists (beyond a one-time offer).
- Dashboards / reporting; non-code analytics config (GTM containers, provider dashboards).

## Acceptance criteria

- **AC-1 (flag registered)** — Given a fresh onboard, When `.config.app` is generated, Then
  it carries a commented `analytics_instrumentation` at default false, and
  `resolveFrameworkConfig` returns `features.analytics_instrumentation === false`. proof_type: unit.
- **AC-2 (OFF is silent)** — Given the flag OFF and a provider present, When a feature edit
  adds an analytics call, Then no `paqad.analytics-tag` row is written and no suggestion is
  emitted. proof_type: unit.
- **AC-3 (ON records)** — Given the flag ON and a detected provider, When the recorder verb
  runs for a tag write, Then exactly one `tag_added` row (preceded by an `open` row on first
  use) lands under `.paqad/ledger/paqad.analytics-tag/<session>/<ordinal>.jsonl`,
  envelope-stamped + schema-valid, with `tag_name`/`tag_provider`/`source_path`. proof_type: unit.
- **AC-4 (best-effort)** — Given a recorder failure (e.g. unwritable dir), When a tag write
  is recorded, Then the verb returns null and never throws. proof_type: unit.
- **AC-5 (script read)** — Given recorded rows, When `foldAnalyticsTagSession` /
  `analytics-tag show` runs, Then it returns the per-session tag counts/rows without an LLM
  in the loop. proof_type: unit.
- **AC-6 (detection)** — Given a project with `posthog-js` in deps and a `posthog.capture(`
  call site, When detection runs, Then `detected_traits`/signals include the provider with a
  confidence and the observed convention. proof_type: unit.
- **AC-7 (cheapest-first gate)** — Given the flag OFF, When the analytics gate resolves,
  Then detection is not invoked (tag = `off`). proof_type: unit.
- **AC-8 (cross-provider record)** — Given a Codex/Gemini completion with a
  `paqad:analytics-tag checkout_completed ga4` marker and the flag ON, When
  `verification-record.mjs` runs with the adapter argv, Then a `tag_added` row lands with
  `adapter` = the host. proof_type: unit.
- **AC-9 (marker parse + idempotent)** — Given a transcript with one analytics marker
  recorded already, When parsed again, Then no duplicate row is written. proof_type: unit.
- **AC-10 (tracking-map reconcile)** — Given `paqad.analytics-tag` rows, When
  `analytics-map reconcile` runs, Then the registry table is rewritten from the rows, the
  hand-authored preamble is preserved, and the file carries the generated header. proof_type: unit.
- **AC-11 (SIEM)** — Given recorded rows, When `audit export` runs, Then the analytics-tag
  events appear in the export stream. proof_type: unit.
- **AC-12 (conflict categories)** — Given a PII/consent conflict, When a decision packet is
  created with category `analytics.pii_consent`, Then it validates and carries sane defaults.
  proof_type: unit.
- **AC-13 (hook specs render)** — Given the new hook specs, When each hook-capable adapter
  generates config, Then commands are cross-platform (`node "<abs>/hooks/..."`, no `.sh`, no
  bare `~`) and the coverage matrix/parity tests still pass. proof_type: unit.
- **AC-14 (green ci)** — `pnpm run ci` passes incl. the 95% branch-coverage gate. proof_type: command.

## Invariants (human-confirmed)

- **INV-1** — The AJV schema and recorder live under `src/`, never `.paqad/`; the LLM can
  neither author a row nor weaken the schema.
- **INV-2** — Coding correctness is never blocked by analytics: recorder/seams are
  best-effort and analytics failure is at most a 🟡.
- **INV-3** — OFF (flag or paqad-disabled) is total silence in every branch: no row, no
  code, no suggestion.
- **INV-4** — Recording and reading are script-driven; no path mints or reads a row from LLM
  free-text except the non-fakeable `paqad:analytics-tag` boundary marker (content authored
  by the substrate, same trust model as `paqad:stage`).
- **INV-5** — What the agent adds is separable and reversible; the tracking-map table is a
  projection of the ledger, so the two can never disagree.
