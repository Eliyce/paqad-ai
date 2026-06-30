# Verification enforcement boundary

Issue [#117](https://github.com/Eliyce/paqad-ai/issues/117) makes paqad's
verification gates **bind**: they fire automatically from hooks and from the
git/CI backstop, against repository reality, with the judgment inputs computed
instead of stubbed. This document is the honest map of what each layer enforces
and what it cannot.

paqad adds **no runtime command** for this. Everything runs from the prompt plus
generated hooks plus the package's exported verification API
(`runRepositoryVerification`).

## The three layers (defense in depth)

No single layer is both provider-agnostic and unbypassable, so enforcement is
layered.

| Layer | Mechanism | Fires when | Coverage | Bypassable? |
| --- | --- | --- | --- | --- |
| **1. Live in-session** | Native pre-tool hooks (`decision-pause-gate.mjs`, `pre-write-check-spec.sh`) | As the offending tool call happens | Hosts with real pre-tool hooks | Yes (host-dependent) |
| **2. Completion** | Each host's native completion hook, rendered into its own config from one definition: Claude `Stop` (`verification-completion.mjs`), Codex `Stop` and Gemini `AfterAgent` (`verification-record.mjs`, record-only) | The moment the agent finishes a turn | Every host with a native completion hook | Yes (agent can be configured without it) |
| **3. Backstop** | Git pre-commit/pre-push (`pre-commit-verify.sh`) + CI step, both running `verify-backstop.mjs` | On commit / in CI | Every agent and every human | Local git: yes (`--no-verify`). **CI: no.** |

Layers 1 and 2 are fast feedback. Layer 3 is the real backstop: an agent cannot
pass `--no-verify` to CI, and CI applies to every agent and to humans.

### What each layer runs

- **Live (layer 1)** blocks a single tool call. The decision-pause gate blocks
  mutating tools while any `.paqad/decisions/pending/D-*.json` is unresolved
  (C-3). The spec gate blocks a write with no spec on the non-fast lanes.
- **Completion + backstop (layers 2 and 3)** run the existing
  `VerificationGateRunner` via `runRepositoryVerification`, which builds a
  `VerificationContext` from repository reality (git diff, traceability map,
  decision store, spec-review reports, quality baseline), computes the judgment
  inputs (C-2), runs the gates the backstop can genuinely evaluate, writes the
  evidence artifact, and returns one machine-readable trust verdict (C-6).

### Stage-evidence enforcement (issue #247)

On every code change, `runRepositoryVerification` also folds the stage-evidence
ledger (`.paqad/ledger/paqad.stage-evidence/`) into a deterministic
`stage-evidence` gate — read from the ledger files on disk, never from an LLM
claim. The gate is **code-change-only** and scoped so it cannot break a project
that has not adopted stage marking:

- Every mandatory stage recorded (`complete`/`recovered`) → **pass**.
- The workflow was started but left incomplete (the agent live-marked at least one
  stage; a mandatory stage is missing) at a **local** origin (`hook-completion` /
  `git-backstop`) → **fail** (flips the trust verdict; the git backstop blocks the
  commit). This is the deterministic teeth: start the workflow, you must finish it.
- The workflow was never marked, or the run is on **CI** (a fresh checkout has no
  committed local ledger) → **skipped** (informational). The committed-receipt path
  that would let CI enforce stage-completeness is deferred.

The completion hook **soft-fails** on infrastructure errors (a missing build, an
import failure) so a broken install never wedges the agent. On hosts other than
Claude Code the completion hook is **record-only** (`verification-record.mjs`):
it writes the evidence ledger but always exits 0 and stays silent, so a host that
reads a Stop-hook's exit code or stdout as a control decision is never blocked or
retried. The CI backstop **fails hard**: infra errors and blocking verdicts both
exit non-zero.

## Per-adapter coverage matrix (C-5)

The live hooks are generated from one definition
(`src/adapters/shared/paqad-hooks.ts`, `HOOK_COVERAGE_MATRIX`). Coverage is
tiered honestly by the host seam each adapter actually wires. Only three adapters
override `generateConfig` to emit an executed native hook; the other seven ship
an entry-file contract the model is asked to follow, with no host seam to bind it
(`capabilities.hooks:false`).

| Adapter | Coverage | Binds | Notes |
| --- | --- | --- | --- |
| claude-code | `live-pre-and-completion` | block before edit + verify at end | `settings.json` PreToolUse + Stop (only PreToolUse-capable host) |
| codex-cli | `live-completion-only` | verify at turn end | `.codex/hooks.json` `Stop`; no in-turn pre-mutation block |
| gemini-cli | `live-completion-only` | verify at turn end | `.gemini/settings.json` `AfterAgent`; no in-turn pre-mutation block |
| cursor | `advisory` | nothing in-session | entry-file contract only |
| windsurf | `advisory` | nothing in-session | entry-file contract only |
| continue | `advisory` | nothing in-session | entry-file contract only |
| github-copilot | `advisory` | nothing in-session | entry-file contract only |
| junie | `advisory` | nothing in-session | entry-file contract only |
| aider | `advisory` | nothing in-session | instruction-only conventions |
| antigravity | `advisory` | nothing in-session | wires no executed native hook |

`advisory` is stated plainly, never implied to bind. claude-code is the only host
with an in-turn pre-mutation block; codex-cli and gemini-cli bind one turn late at
completion. The previous matrix mislabelled cursor/windsurf as live and omitted
continue/copilot/junie — corrected in buildout F7b.

## What the backstop computes vs. skips

The backstop runs only the gates it can evaluate from artifacts:

- **Computed (C-2):** `ac-test-mapping` from the traceability map,
  `implementation-review` from unresolved decision packets, `spec-review` from
  spec-review reports. `change-completeness` adds scope-drift (C-4) against the
  derived spec boundary. `quality-ratchet`, `documentation-freshness`,
  `mutation-testing`, and the doc-structure gates compute genuine results.
- **Skipped (reported as `skipped`, never passed vacuously):** the pure
  model-judgment gates `requirement-completeness`, `story-quality`,
  `architecture-compliance`, `behavioral-correctness`, `database-quality`, and
  `code-tests-lint` (CI runs lint/test/typecheck as separate steps). These are
  provider-workflow concerns the backstop cannot re-judge.
- **Inconclusive escalation:** a signal that cannot be proven either way
  (e.g. "code changed but no frozen spec on record") is surfaced in the verdict
  as an escalation rather than silently passed or used to block every change.

## Honest limitations

- **Local git hooks are bypassable.** `git commit --no-verify` skips
  `pre-commit-verify.sh`. CI is therefore the non-negotiable layer.
- **MCP cannot govern native tools.** An MCP server cannot police an agent's
  built-in file/shell tools, so MCP is not an enforcement point here.
- **Only CI and the OS/sandbox boundary are truly agent-independent.** The live
  hooks are convenience and fast feedback; the backstop is the guarantee.
- **Spec-freeze judgment is partial.** Where spec persistence is not a clean
  on-disk artifact, the backstop relies on the traceability map and spec-review
  reports and escalates (inconclusive) rather than asserting a vacuous pass.

## CI integration

Add the backstop to CI as a required step (an agent cannot pass `--no-verify` to
CI):

```yaml
- name: paqad verification backstop
  run: node node_modules/paqad-ai/runtime/scripts/verify-backstop.mjs ci-backstop
```

The step exits non-zero on any blocking gate, with a machine-readable verdict on
the engine event stream (`verification-verdict`) and in
`.paqad/session/verification-evidence.json`.
