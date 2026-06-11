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
| **1. Live in-session** | Native pre-tool hooks (`decision-pause-gate.sh`, `pre-write-check-spec.sh`) | As the offending tool call happens | Hosts with real pre-tool hooks | Yes (host-dependent) |
| **2. Completion** | `Stop` / completion hook (`verification-completion.mjs`) | The moment the agent finishes | Hosts with a completion/stop hook | Yes (agent can be configured without it) |
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

The completion hook **soft-fails** on infrastructure errors (a missing build, an
import failure) so a broken install never wedges the agent. The CI backstop
**fails hard**: infra errors and blocking verdicts both exit non-zero.

## Per-adapter coverage matrix (C-5)

The live hooks (layers 1 and 2) are generated for hook-capable hosts from one
definition (`src/adapters/shared/paqad-hooks.ts`). Hosts without reliable
pre-tool/stop hooks are covered by the git/CI backstop only.

| Adapter | Live (layers 1–2) | Backstop (layer 3) | Notes |
| --- | --- | --- | --- |
| claude-code | yes (wired) | yes | Reference host; `settings.json` PreToolUse + Stop |
| codex-cli | host-capable | yes | Hooks with partial tool coverage |
| gemini-cli | host-capable | yes | |
| cursor | host-capable | yes | No pre-edit block; rules are instruction-only |
| windsurf | host-capable | yes | Cascade pre-hooks |
| aider | no | yes | Conventions are instruction-only |
| antigravity | no | yes | Gate unreliable |

"host-capable" means the host exposes the hook surface and renders from the
shared spec; the non-negotiable enforcement for those hosts today is the git/CI
backstop. claude-code is the fully live-wired reference.

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
