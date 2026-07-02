# Feature Spec — Analytics v2: tracking-plan-as-code (issue #279)

Status: **frozen** (2026-07-02). Lane: full. Owner: Haider. Refines/partly supersedes #241.

## 1. Summary & precedence contract

Analytics v2 turns instrumentation into a **tracking plan as code**. When the
`analytics_instrumentation` flag is ON, paqad makes every feature instrument its events,
documents each event as a reviewed, versioned **per-event doc**, and governs every new
event through the **Decision Pause Contract** — so a team gets a shared, attributed,
drift-resistant record of what is tracked and why, native to the normal PR.

The **per-event docs tree is the single source of truth**. The `paqad.analytics-tag`
ledger shipped in #241/1.40.0 is **removed** (redundant with the docs). Analytics stays
coding-first: it never blocks a correct build and never fails CI on an SDK outage.

Honest limits (never overclaimed): not type-safe codegen; not ingestion-time / real-time
blocking; not PII redaction at capture; single flag is not per-event lifecycle. Enforcement
is PR/review-time via doc + AC existence only.

## 2. Governance triple (per event)

1. **Decision packet** (who / why / approved). Every new event, from the first, opens a
   Decision Pause packet capturing the proposed event name + normalized slug, provider(s),
   feature/module, and rationale; surfaces the name/casing/taxonomy/PII check for a human
   to approve, rename, or decline. Resolved `D-<ULID>` packets commit with the PR.
2. **Per-event doc** (what it means). `docs/modules/{module}/analytics/{feature}/{event}.md`,
   one doc per event, a **section per provider**. Filename is a normalized slug; the exact
   event string is recorded inside, so `Song Played` and `song played` collapse to one doc
   and the casing conflict is caught at write time. Plus a per-module `analytics/index.md`.
3. **AC + traceability** (proof). One `AC-TRACK` per event (1:1 with the doc), carried
   through spec freeze; the traceability map proves the AC against delivering code + doc and
   raises `TR-UNTESTED-PROMISE` when an event is promised but not proven.

## 3. Enforcement knob

- `analytics_instrumentation` — single global on/off (OR-logic across detected providers).
- `analytics_strictness` — `off | warn | strict`, **default `warn`** (confirmed Haider
  2026-07-02), modeled on `rule_compliance` / `stages_mode` (`STAGE_RULE_MODES`), strict is
  opt-in and **never auto-escalated**. `off`: total silence, detection short-circuited.
  `warn`: missing tracking doc / unproven `AC-TRACK` is a 🟡 at completion, never blocks.
  `strict`: the same blocks on Done, requiring the **event doc** to exist (not each provider
  section — provider detection has confidence; avoid false-blocks).

## 4. Acceptance criteria

- AC-1: Given the flag OFF, when a feature adds an analytics call, then no doc, no AC, and
  no decision packet are produced (OFF is silent). (proof: automated)
- AC-2: Given the flag ON + feature-shaped + a provider detected, when the gate resolves,
  then status `instrument` and the sidecar `.paqad/planning/analytics-decision.json` is
  written. (proof: automated)
- AC-3: Given a frozen spec with an `AC-TRACK`, when traceability runs, then the event is a
  promise proven only when its per-event doc + delivering code + a check exist, else
  `TR-UNTESTED-PROMISE`. (proof: automated)
- AC-4: Given two events differing only by casing, when docs generate, then they collapse to
  one normalized-slug doc and the casing conflict surfaces. (proof: automated)
- AC-5: Given a new event, when instrumentation is planned, then a Decision Pause packet
  (who/why + name/casing/taxonomy/PII) is created and must resolve before the event lands.
  (proof: automated)
- AC-6: Given `analytics_strictness=strict` and a missing event doc, when completion runs,
  then it blocks on Done; given `warn`, it is a 🟡; given `off`, silent. (proof: automated)
- AC-7: Given the flag OFF, when framework rules compile, then zero analytics-gated rule
  bytes are compiled. (proof: automated)

## 5. Kept / removed / new (vs #241)

**Kept:** `analytics_instrumentation` flag; provider + convention detection
(`src/analytics/detect|providers|call-sites`); classify-time gate +
`.paqad/planning/analytics-decision.json` sidecar; conflict decision-pause categories.

**Removed (slice 1):** `src/analytics-tag/` (recorder, schema, types, fold, marker-parse,
live-writer, registry) + tests; hooks `analytics-tag-writer.mjs`,
`analytics-tag-marker-parse.mjs`; the `verification-record.mjs` analytics fold + its two
`PAQAD_LIVE_HOOKS` specs; the `paqad:analytics-tag` marker; SIEM inclusion in
`src/audit/aggregate.ts`; the `paqad-ai analytics` CLI.

**New (slices 2-7):** detection into `onboard` + `docs/instructions/stack/analytics.md`;
compile-time flag-gated framework rules (`gate:` frontmatter in rule-compiler); per-event
docs tree + per-module index + doc-syncer + isolation; flag-on stage injection; new-event
Decision Pause packets; tracking AC + AC/doc-existence gate; the `analytics-instrumentation`
skill (templates write code + doc).

## 6. Invariants

- INV-1: OFF is free and silent everywhere (no detection, no rules, no docs, no packets).
- INV-2: Analytics never turns a feature 🔴; a missing tag/doc is at most 🟡 (or a strict
  block on Done, opt-in).
- INV-3: One event ↔ one doc ↔ one `AC-TRACK` ↔ one decision packet.
