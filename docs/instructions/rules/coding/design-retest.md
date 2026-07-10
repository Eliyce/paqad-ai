# Design-Retest Workflow

## Purpose

Re-evaluate prior design-test findings against the current state of the UI so a retest report can classify each finding as `fixed`, `still-open`, or `needs-manual-verification` without re-deriving context. Mirror of `pentest-retest`.

## Trigger

Run this workflow whenever the user says anything equivalent to:

- "design retest", "design-retest", "retest design", "retest design findings"

## Inputs

- The source `docs/design-test/<timestamp>.json` sidecar (the machine-readable companion of a prior design-test report).
- `docs/instructions/design-system/**` (contract — may have changed since the original run).
- Fresh evidence: AST scan + Playwright walk against the current working tree.

If the source sidecar path is not supplied in the request, default to the most recent file matching `docs/design-test/*.json`.

## Workflow Steps

Progress is tracked in `.paqad/design-test/runs/<run_id>/progress.json` with `mode: retest` and `source_report: <path>`.

### Step 1 — load-source-findings

- Read the source sidecar. Validate against the design-test finding schema (same one `finding-normalizer` enforces).
- Build an in-memory index keyed by `DT-XXXX` id.
- Preserve every finding's original `severity`, `category`, `contract_ref`, and `playbook_ref` — retest does **not** re-derive these.

### Step 2 — gather-fresh-evidence

For each finding, gather only the evidence needed to re-classify it:

- `category: token` / `component` → re-run `scan-tokens.sh` and `scan-overrides.sh` over the file referenced in `evidence`; check whether the offending literal still exists at `file:line` (or has moved, in which case search the file).
- `category: state` / `a11y` / `responsive` / `motion` → re-run the relevant Playwright snippet from the original playbook (`playbook_ref`).
- `category: documentation-drift` → re-read the referenced `docs/modules/*/ui/**` file and the contract clause; check whether they now agree.
- `category: performance` → re-run the perf budget probe.

### Step 3 — classify-status

For each finding, pick a status from `assets/status-vocabulary.txt` (shared with `retest-verification`):

- `fixed` — the offending evidence is gone AND the contract clause is now satisfied.
- `still-open` — the offending evidence remains.
- `needs-manual-verification` — automated evidence is inconclusive (e.g., a visual-regression diff that requires a human eye).

Findings whose `contract_ref` no longer exists in the contract get a synthetic `still-open` with a `contract-removed` note — the user removed the rule rather than fixing the code; the maintainer should confirm intent.

### Step 4 — write-retest-report

- `docs/design-test/<original-timestamp>-retest-<retest-timestamp>.md` — human report
- `docs/design-test/<original-timestamp>-retest-<retest-timestamp>.json` — machine sidecar with the same `DT-XXXX` ids and the new `status` field
- Summary block at the top: `fixed: N | still-open: N | needs-manual-verification: N | contract-removed: N`

## Rules

- Never invent new `DT-XXXX` ids during a retest. New findings discovered during retest are out of scope — run a fresh `design-test` for those.
- Never lower a finding's severity during retest. Severity is a property of the source report; retest only updates `status`.
- If the source sidecar is missing or malformed, stop and ask the user to point at a valid sidecar.
- Always write both the `.md` and `.json` retest outputs.
