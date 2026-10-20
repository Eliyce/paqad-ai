# Fix Proof: API View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `fix-proof`

## `paqad-ai fix prove <red|green>`

```text
paqad-ai fix prove <red|green> --test-file <path> --test-id <id> --command <cmd>
                   [--timeout <seconds>] [--project-root <path>] [--session <id>] [--silent]
```

- `--test-file`: the file holding the proof test.
- `--test-id`: the test name as the runner prints it; a red run must name it.
- `--command`: the command that runs the proof test.
- `--timeout`: seconds before the command is stopped (default 600).
- `--session`: defaults to `SE_SESSION`, then `CLAUDE_SESSION_ID`.

Output: a `▸ paqad · fix proof <phase>` line, the outcome line (for example "🟢 green recorded:
the proof passes after the fix"), the reason, then unless `--silent`
`{"recorded":true,"phase","outcome","exit_code","duration_ms"}`.

Exit codes: `0` when a row is recorded with any outcome but `error`; `1` for an `error` row, an
unknown phase, a bad timeout or no active change.

## Library surface

- `proveFix(input): Promise<FixProofRow>` in `src/fix-protocol/fix-prove.ts`.
- `readFixProofRows(projectRoot, dirName)`, `appendFixProofRow(...)`,
  `foldFixProofState(rows)`, `FIX_PROOF_STATE_LABEL` in `src/fix-protocol/fix-proof-record.ts`.
- `evaluateFixProof(input)`, `summarizeFixProof(input)`, `fixProofGate(input, summary)` in
  `src/verification/repository/fix-proof-gate.ts`.
