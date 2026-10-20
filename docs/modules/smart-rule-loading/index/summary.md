# Smart Rule Loading

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `smart-rule-loading`

## Purpose

Replace "load all ~50K of rule text every session" with a deterministic,
token-lean scheme (RAG buildout Phase 2). The model always knows that every rule
exists and when it applies, while the full text of a rule is deferred until its
declared triggers match what is being touched — and script-enforced rules stay
enforced regardless of what is in context. This is deliberately deterministic
(declared triggers + scripts), never an embedding-RAG guess: omitting a rule is a
correctness failure.

This module rides the session-time injection seam (`context-seam`) for delivery
and the background-worker harness for freshness.

**Loading is required and recorded.** Materializing the applicable
full rule text into the artifact is only half the job — without the rules-loaded record nothing
would record or require that the agent read it, so a change could go fully green with
every rule unread. `computeRuleApplicability` (in `rule-context.ts`) is the one
deterministic source of the applicable set and the loaded-rule-text hash, reused by
`paqad-ai rules load` (which prints the applicable text and writes
`rules-loaded.json`), the edit-time `rules-loaded` kernel capability (blocks the
first source edit until that record exists), and the completion-seam
`rules-loaded-gate` (fails a change that never loaded its rules). The record attests
loading and acknowledgment, never comprehension.

## Source Footprint

- `src/context/rule-manifest.ts`
- `src/context/rule-context.ts`
- `src/pipeline/rule-trigger-matcher.ts`
- `src/rule-scripts/enforce.ts`

## Features

- [Rule Manifest (always-resident index of every rule)](../features/rule-manifest/business.md)
- [Trigger-Load (full rule text for the files in play)](../features/trigger-load/business.md)
- [Script Enforcement (scripted rules enforced regardless of context)](../features/script-enforcement/business.md)

## Why the code works the way it does

The reasons below are not obvious from the code of the rule slice.

- **`src/context/rule-context.ts`.** Rule text is selected by declared triggers, never by
  embedding search, because leaving out a rule that applies is a correctness failure. The
  resident footprint (manifest plus always-load rules, no files in play) must stay under a fixed
  byte budget of about four thousand tokens; it is a documented constant, not a snapshot of one
  project, and `paqad-ai doctor` reports each project's real footprint. When rules were expected
  but none made it in (no store, or an empty one), a fallback marker is prepended, because the
  bootstrap only loads the full rules tree when the artifact is missing and a rule-less artifact
  would otherwise look like a valid contract. On a route that is not feature-development the
  rules are left out on purpose, so neither the rule slice, the marker, the decision-pause
  reminder nor the existing-surface digest is composed (the digest is dropped even if a caller
  passed it). The loaded rule text comes from one function, and `rules load` and the completion
  gate hash exactly those bytes. The working set skips paqad's own `.paqad/` files and, with a
  session id, files that were already dirty at session start and are unchanged, the same
  subtraction the completion backstop applies, so the load and the check agree. The section order
  is rules, existing surface, codebase memory, retrieval, then the base-drift heads-up. A stale
  compiled store is recompiled inside the refresh lock before it is read; a compile error is
  swallowed so one bad rule file never bricks a session, and an absent rules tree never
  overwrites an existing store. A lock older than ten minutes is reclaimed, and the shared
  `.paqad/locks` parent is left in place.
- **`src/context/rule-manifest.ts`.** The manifest is regenerated synchronously wherever rules
  recompile, so it tracks `compiled-rules.json` without the background harness. Summaries drop
  backticks and trigger spans are joined by spaces, so the manifest can never emit the corrupted
  `` `, ` `` sequence. An absent rule-script map means no rule shows as scripted.

## Authority

The single source of truth for this module's identity, slug, feature names, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml). If anything
in this page disagrees with the map, the **map wins** — update the map first, then regenerate this
page via `create module documentation`.

## How to Update These Docs

1. Edit `docs/instructions/rules/module-map.yml` if the module or feature names changed.
2. Run `create module documentation` in your AI agent (Claude Code, Codex, Cursor, …).
3. Review the regenerated business + technical pages per feature.

## Related

- Delivery channel: [`docs/modules/context-seam/index/summary.md`](../../context-seam/index/summary.md)
- Rules bundle: [`docs/modules/rules-runtime/index/summary.md`](../../rules-runtime/index/summary.md)
- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
