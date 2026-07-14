# Health-Retest Workflow

## Purpose

Re-run a prior codebase-health report and check off what got fixed. The retest never
invents findings and never lowers severity — it re-runs the same deterministic evidence and
reclassifies each source finding by its stable `HL-` id.

## Trigger

Run this workflow whenever the user says anything equivalent to:

- "health retest", "re-run the health check", "did my health findings get fixed?"

For a fresh audit, use the `codebase-health` workflow instead.

## Inputs

- The source report sidecar. By default the newest `docs/health/*.json`; the user may name a
  specific one.

## Workflow Steps

### Step 1 — run the verb

Run `paqad-ai health retest` (optionally `--sidecar <path>` to pick a specific source report,
`--offline` to skip network checks). It reads the source sidecar, re-runs the evidence, and
reclassifies each finding.

### Step 2 — read the retest JSON

Each source finding is now `fixed`, `still-open`, or `needs-manual-verification`, matched by
its `HL-` id. A network-required finding that could not be re-checked offline is
`needs-manual-verification`, not silently fixed.

### Step 3 — narrate the result

Report, in the paqad voice: how many are fixed, how many are still open, and how many need a
manual check. The verdict is Safe to merge only when nothing is still open. The retest report
is written to `docs/health/<orig-ts>-retest-<ts>.{md,json}`.

## Rules

- Never invent a new finding in a retest, and never lower a finding's severity.
- Match by stable `HL-` id, not by category.
- A network-required finding you could not re-check is `needs-manual-verification`, never `fixed`.
