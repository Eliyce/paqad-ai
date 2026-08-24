# Decision Pause Contract — where the contract lives

> **Status:** relocated to the framework bootstrap in #229 (was a managed project doc, #37); moved into the router half of the gate/router split in #498 &nbsp;·&nbsp; **Owner:** framework-internals

## Why the contract lives in the framework install

Every provider entry file (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/…`,
`.windsurfrules`, `.continue/…`, `GEMINI.md`, `.junie/AGENTS.md`,
`ANTIGRAVITY.md`, `.github/copilot-instructions.md`, the Aider config) is
auto-injected into every agent session, so any prose inlined there competes with
the host's own system prompt for the model's instruction-following budget — and,
critically, is loaded **whether or not paqad is enabled**.

Issue #229 makes every entry file a **lean stub**: a one-line pointer to the
framework bootstrap plus the graceful-degradation fallback clause and the
`Adapter:` footer. The Decision Pause Contract (and the narration contract, and
the load order) moved **out of the project entirely** and into one framework-owned
file in the install.

## The architecture

1. **Two framework-owned docs, a gate + a router** (split in #498), both shipped in
   the install (`~/.paqad-ai/current`, the directory `.paqad/framework-path.txt`
   resolves to) and both **never written into a project** — they are reached via the
   install symlink. `runtime/AGENT-BOOTSTRAP.md` is the **gate**: its only job is the
   enablement check plus a pointer to load `runtime/AGENT-ROUTER.md` when paqad is ON.
   The **router** is what inlines the full contracts (and the load order). A disabled
   project loads neither the router nor any contract prose. Both are assembled by the
   same builder file —
   [`buildAgentBootstrapDocument()`](../../../src/onboarding/agent-bootstrap-writer.ts)
   for the gate and `buildAgentRouterDocument()` for the router — and each is kept
   byte-identical to its committed file by a golden test
   (`tests/unit/onboarding/agent-bootstrap-writer.test.ts`).

2. **The contract body** is built by
   [`buildDecisionPauseContractBody()`](../../../src/onboarding/decision-pause-contract-writer.ts)
   and inlined into the **router** (`AGENT-ROUTER.md`), including the per-adapter UI
   table. The agent selects the row matching the `Adapter:` footer in the lean entry
   file that pointed it (via the gate) to the router (e.g. `AskUserQuestion` — the
   Claude Code decision "tray" — for `claude-code`).

3. **A per-adapter UI shim** at
   [`src/adapters/shared/decision-pause-ui-shim.ts`](../../../src/adapters/shared/decision-pause-ui-shim.ts)
   maps each `AdapterType` to the interactive UI primitive its host exposes.
   Unknown adapters fall back to the file-wait fallback documented in the contract.

The project-level `.paqad/decision-pause-contract.md` is **no longer written**.
Onboarding and `paqad refresh --providers` prune any stale pre-#229 copy via
[`removeObsoleteContractDocs`](../../../src/onboarding/obsolete-cleanup.ts).

## Single source of truth for categories

The `## Categories` block in the contract body is generated from
`DECISION_CATEGORIES` in
[`src/planning/decision-packet.ts`](../../../src/planning/decision-packet.ts). The
router golden test asserts the rendered router lists every member, so the contract
cannot drift from the runtime as categories are added.

## Drift detection

[`inspectProviderEntryBootstrapPointer`](../../../src/health/provider-entry-contract.ts)
checks that every present entry file is a lean stub that points to the bootstrap
(and warns if a stale pre-#229 entry file still inlines a contract section);
[`inspectProviderEntryFallbackClause`](../../../src/health/provider-entry-contract.ts)
checks the fallback clause is present. The remediation hint points at
`paqad refresh --providers`.

## Refresh contract

`paqad refresh --providers`:

- Re-renders the lean entry files for adapters whose config file is already
  present on disk. It will not silently onboard new providers.
- Prunes any obsolete project-level contract copy (it never writes one).

When the contract text or per-adapter UI notes change in a framework release,
projects pick up the change automatically: the bootstrap ships in the install, so
there is nothing per-project to refresh for the contract itself.

## What to change when

| Change | Edit |
| --- | --- |
| Add a new Decision category | [`src/planning/decision-packet.ts`](../../../src/planning/decision-packet.ts) — the bootstrap updates on next golden-test regen. |
| Reword the resolution flow | [`src/onboarding/decision-pause-contract-writer.ts`](../../../src/onboarding/decision-pause-contract-writer.ts), then regenerate the router. |
| Adjust a per-adapter UI note | [`src/adapters/shared/decision-pause-ui-shim.ts`](../../../src/adapters/shared/decision-pause-ui-shim.ts). |
| Change the gate or router structure | [`src/onboarding/agent-bootstrap-writer.ts`](../../../src/onboarding/agent-bootstrap-writer.ts) (regenerate `runtime/AGENT-BOOTSTRAP.md` and `runtime/AGENT-ROUTER.md` with `pnpm vitest run agent-bootstrap-writer -u`). |
| Change the lean entry-file shape | [`runtime/templates/agent-configs/*.md.hbs`](../../../runtime/templates/agent-configs/) — kept lean per `docs/instructions/rules/coding/agent-entry-files.md`. |

## Related

- [Decision Pause Contract module summary](./index/summary.md)
- [`src/onboarding/agent-bootstrap-writer.ts`](../../../src/onboarding/agent-bootstrap-writer.ts)
- [`src/onboarding/decision-pause-contract-writer.ts`](../../../src/onboarding/decision-pause-contract-writer.ts)
