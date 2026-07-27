# Site-Map-Retest Workflow

## Purpose

Re-run a prior site-map report against the current code and check off what changed. The retest
never invents surfaces or findings and never lowers severity — it replays the same source
findings by their stable `SM-` id and reclassifies each one from fresh deterministic evidence.

## Trigger

Run this workflow whenever the user says anything equivalent to:

- "site map retest", "retest the site map", "did the map drift?"

For a fresh map, use the `site-map` workflow instead. This workflow is behind the `site_map`
flag (env `PAQAD_SITE_MAP`); when the flag is off, nothing here loads or runs.

## Inputs

- The source report sidecar. By default the newest `docs/site-map/*.json`; the user may name a
  specific one.

## Workflow Steps

### Step 1 — run the verb

Run `paqad-ai sitemap retest` (optionally `--sidecar <path>` to pick a specific source report).
It reads the source sidecar, re-extracts and re-resolves the evidence for each finding, and
reclassifies it.

### Step 2 — read the retest JSON

Each source finding is now `fixed`, `still-open`, or `needs-manual-verification`, matched by its
`SM-` id. A surface whose evidence went missing is `still-open` (drift), never silently
`fixed`; a claim the engine could not settle deterministically is `needs-manual-verification`.

### Step 3 — narrate the result

Report, in the paqad voice: how many map gaps are fixed, how many are still open, and how many
need a manual check. The verdict is Safe to merge only when nothing is still open. The retest
report is written to `docs/site-map/<orig-ts>-retest-<ts>.{md,json}`.

## Rules

- Never invent a new finding in a retest, and never lower a finding's severity.
- Match by stable `SM-` id, not by category or surface label.
- A surface whose cited evidence no longer resolves is `still-open`, never `fixed`; absence of
  proof is drift, not a fix.
