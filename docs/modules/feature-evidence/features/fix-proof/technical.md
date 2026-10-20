# Fix Proof: Technical View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `fix-proof`

## Module Boundaries

- `src/fix-protocol/fix-prove.ts`: runs the proof command and builds the row (`proveFix`,
  `runProofCommand`, `DEFAULT_PROOF_TIMEOUT_MS` of 10 minutes).
- `src/fix-protocol/fix-proof-record.ts`: the `fix-proof.json` rows and the state fold.
- `src/fix-protocol/fix-change.ts`: reads the change's diff and decides whether it can affect
  behaviour.
- `src/verification/repository/fix-proof-gate.ts`: the `fix-proof` gate on the receipt.
- `src/cli/commands/fix.ts`: `paqad-ai fix prove`.

## Data Model

`fix-proof.json` in the change's bundle holds `rows`, appended in order. Each row:

| Field | Meaning |
| --- | --- |
| `phase` | `red` or `green` |
| `outcome` | `red`, `not-reproduced`, `green`, `still-failing`, `held` or `error` |
| `test_file`, `test_id`, `command` | what was run |
| `exit_code`, `timed_out`, `duration_ms` | how it ran |
| `commit`, `tree_dirty` | HEAD and whether the tree had changes |
| `at`, `reason` | when, and the plain-words reason |
| `output_tail` | the last lines of output |
| `baseline_failing` | on a red row, the tests already failing before the fix |
| `protocol_status`, `guard_path` | set when the green run compares against that baseline |

## Behaviour

- The command is parsed as a plain command chain and run without a shell; unsupported shell syntax
  is an `error` row, never run.
- **Red.** Exit 0 is `not-reproduced`. A failure whose output does not contain `--test-id` is
  `error`. Otherwise `red`, and the tests already failing are kept as the baseline.
- **Green.** With a counted red row, the run is compared with that baseline: the proof passing
  with nothing newly broken is `green`, the proof still failing is `still-failing`, and a check
  that passed before now failing is `held`. With no red row, a pass is `green` (read later as
  "green only") and a failure is `still-failing`.
- **State fold** (`foldFixProofState`): `red-green` when a counted red is followed by a green;
  `held` when the last settled row after red is held; `red` when no green followed; `green-only`,
  `not-reproduced` or `none` otherwise.
- **Gate.** Only on a feature-development change whose feature record has `kind: fix`. When the
  diff cannot affect behaviour the gate is `skipped` (not required). `red-green` passes. Every
  other state is `inconclusive` with the missing step as the remediation, for example "Run
  `paqad-ai fix prove green` now that the fix is in.". An unreadable diff requires proof.
