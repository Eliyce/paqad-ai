# Context Injection Seam

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `context-seam`

## Purpose

The session-time delivery channel for everything paqad wants in front of the
model (RAG buildout F2). A `UserPromptSubmit` hook reads a **precomputed**
context artifact off disk and emits it as a `[paqad-context]` block on stdout, so
the host injects it into the model context before the turn is planned. The seam
itself does no heavy work — only a stat + read of a finished artifact under a
hard time budget; the background-worker harness keeps that artifact fresh. Smart
rule loading (F4/F5), wired retrieval (F11/F13), stage gating (F14), and the
codebase-memory tier (F21) all ride on this one channel. A missing, empty,
disabled, or too-slow-to-read artifact emits nothing, so the agent falls back to
grep/read exactly as today.

## Source Footprint

- `runtime/scripts/context-seam.mjs`
- `runtime/hooks/context-seam-inject.mjs`
- `runtime/hooks/agent-entry-prompt-gate.mjs`

## Features

- [Budgeted Artifact Read (resolve + read + ceiling)](../features/budgeted-read/business.md)
- [Context Block Emit (`[paqad-context]` + hook wiring)](../features/context-block-emit/business.md)

## Why the code works the way it does

The reasons below are not obvious from the code in `runtime/scripts/context-seam.mjs`.

- **Budgets.** The read deadline only guards against pathological filesystem latency: if the stat
  or the read overruns it, the seam emits nothing rather than stall the prompt or emit late.
  `maxBytes` is only a ceiling for a corrupt or huge file, cut with a visible marker; the real
  token budget is upstream's job. Every external effect (clock, stat, read) is injectable so the
  logic is deterministic under test.
- **Host output cap.** Claude Code caps a hook's `additionalContext`, `systemMessage` or plain
  stdout at 10,000 characters and saves anything longer to a file the model never reads. The
  budget leaves about 1,000 characters of headroom, counted in characters, not bytes.
  `fitHookOutput` keeps the route line and the nudge whole and trims only the context body,
  ending the block with the trim notice. With no parseable block there is nothing safe to drop, so
  it emits what it has.
- **Switches.** `lean_rules` defaults on (only an explicit falsy token turns it off) and
  `rag_enabled` defaults off (only an explicit truthy token turns it on), mirroring the
  framework-config boolean parse. `PAQAD_CONTEXT_ARTIFACT` overrides the artifact path, absolute
  or relative to the project root, so tests and other hosts can point elsewhere.
- **Stripping the rule sections.** The artifact is shared by every session in a checkout and may
  have been composed for another session's feature-development prompt, so a prompt routed
  elsewhere drops the rule-contract sections and the "no compiled rules" marker. Only the
  composer's own top-level headings end a section, because loaded rule text embeds each rule's own
  markdown (such as a `## Verify` heading), which must be dropped with the rule rather than end the
  section early.

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

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Background harness (keeps the artifact fresh): [`docs/modules/background-harness/index/summary.md`](../../background-harness/index/summary.md)
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
