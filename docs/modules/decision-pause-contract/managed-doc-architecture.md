# Decision Pause Contract — managed-doc architecture

> **Status:** stable since #37 &nbsp;·&nbsp; **Owner:** framework-internals

## Why a managed external doc

Every provider entry file (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/…`,
`.windsurf/rules/…`, `.continue/…`, `GEMINI.md`, `.junie/AGENTS.md`,
`ANTIGRAVITY.md`, `.github/copilot-instructions.md`, the Aider config) is
loaded into every agent session, so any prose we inline there competes
with the host's own system prompt for the model's limited
instruction-following budget. Inlining the full Decision Pause
resolution flow into all ten entry files burns budget *and* fragments
the source of truth across ten paths.

The architecture introduced in #37 splits the contract into:

1. **One canonical, managed file** at
   [`.paqad/decision-pause-contract.md`](../../../.paqad/decision-pause-contract.md).
   Written by onboarding and re-rendered by `paqad refresh --providers`.
   It carries a `<!-- managed by paqad-ai — do not edit -->` header and
   re-runs are byte-identical when the canonical content has not
   changed (see
   [`writeMarkdownIfChanged`](../../../src/onboarding/decision-pause-contract-writer.ts)).

2. **A thin pointer** rendered into every provider entry file by
   [`buildDecisionPauseContractSection(adapter)`](../../../src/adapters/shared/provider-entry-contract.ts).
   The pointer body is identical across adapters; only a one-sentence
   per-adapter UI note differs.

3. **A per-adapter UI shim** at
   [`src/adapters/shared/decision-pause-ui-shim.ts`](../../../src/adapters/shared/decision-pause-ui-shim.ts)
   that maps each `AdapterType` to the interactive UI primitive its host
   exposes (`AskUserQuestion` for Claude Code, `/ask` mode for Aider,
   inline prompts for the CLI agents, chat for Cursor / Copilot /
   Windsurf / Continue). Unknown adapters fall back to the file-wait
   fallback documented in the canonical doc.

## Single source of truth for categories

The `## Categories` block in the canonical doc is generated from
`DECISION_CATEGORIES` in
[`src/planning/decision-packet.ts`](../../../src/planning/decision-packet.ts).
A unit test asserts that the doc lists every member of the enum, so the
doc cannot drift from the runtime as new categories are added.

## Drift detection

[`inspectProviderEntryDecisionPauseContracts`](../../../src/health/provider-entry-contract.ts)
compares each existing provider entry file against its adapter's expected
rendering (pointer + correct UI note) and warns when the canonical doc
is missing. The remediation hint always points at
`paqad refresh --providers`.

## Refresh contract

`paqad refresh --providers`:

- Re-renders entry files for adapters whose config file is already
  present on disk. It will not silently onboard new providers.
- Rewrites `.paqad/decision-pause-contract.md` unconditionally — the
  managed file is canonical-only and any drift is intentional drift
  back to canonical.

When the contract text or per-adapter UI notes change in a framework
release, projects pick up the change on their next `paqad refresh
--providers`. No project YAML edits are required.

## What to change when

| Change | Edit |
| --- | --- |
| Add a new Decision category | [`src/planning/decision-packet.ts`](../../../src/planning/decision-packet.ts) — the doc updates on next refresh. |
| Reword the resolution flow | [`src/onboarding/decision-pause-contract-writer.ts`](../../../src/onboarding/decision-pause-contract-writer.ts). |
| Adjust a per-adapter UI note | [`src/adapters/shared/decision-pause-ui-shim.ts`](../../../src/adapters/shared/decision-pause-ui-shim.ts). |
| Change the entry-file pointer shape | [`src/adapters/shared/provider-entry-contract.ts`](../../../src/adapters/shared/provider-entry-contract.ts). |

## Related

- [Decision Pause Contract module summary](./index/summary.md)
- [`src/adapters/shared/`](../../../src/adapters/shared/)
- [`src/onboarding/decision-pause-contract-writer.ts`](../../../src/onboarding/decision-pause-contract-writer.ts)
