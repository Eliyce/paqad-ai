# Site-Map-Retest Workflow

## Purpose

Re-check the stored site map against the current code. There is no separate retest engine and
no report replay: a re-run is simply the same verification the `site-map` workflow runs,
executed again over the one stored map at `docs/site-map/`. The engine re-resolves every cited
`file:line`, re-derives the findings, and re-stamps the map's earned trust tiers and its
map-vs-code freshness, so drift shows up as proof in the map itself.

## Trigger

Run this workflow whenever the user says anything equivalent to:

- "site map retest", "retest the site map", "did the map drift?"

For a fresh map, use the `site-map` workflow instead. This workflow is behind the `site_map`
flag (env `PAQAD_SITE_MAP`); when the flag is off, nothing here loads or runs.

## Workflow Steps

### Step 1 — run the verb

Run `paqad-ai sitemap run` (or hit Run on the dashboard's Site map area). It verifies the
stored map against the current code and stamps the earned trust and freshness back into it.

### Step 2 — read the drift

The stamped freshness is the drift verdict: `anchors_broken > 0` means code the map cites no
longer resolves — the map has drifted. Finding ids are content-addressed (`SM-<hash8>`), so a
finding that persists across runs keeps its id and the baseline ratchet marks it
`pre-existing`; a finding that disappears was fixed by the code or map change that removed its
evidence.

### Step 3 — narrate the result

Report, in the paqad voice: whether the map still matches the code, how many cited anchors
broke, and which findings are new since the baseline versus pre-existing. The verdict is Safe
to merge only when the run exits clean and no cited anchor is broken.

## Rules

- Never invent a finding in a re-run, and never soften one: absence of proof is drift, not a
  fix — a surface whose cited evidence no longer resolves is a finding, never silently fine.
- The stamped freshness in the stored map is the drift signal downstream gates read; never
  hand-edit it. Only the verb writes it.
- A re-run writes no reports: `docs/site-map/` holds only the current map.
