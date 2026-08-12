# Re-run rules

A re-run is a re-check, not a re-audit with moved goalposts. Its whole value is that it answers
one question honestly — does the stored map still match the code — using the exact verification
the `site-map` workflow runs. These are the rules that keep it honest.

## One engine, one map

- There is no separate retest engine and no report replay. The re-run is `paqad-ai sitemap run`
  over the one stored map at `docs/site-map/`, and its lasting record is the trust and
  freshness the engine stamps back into that map.

## Match by stable id, never by label

- Finding ids are content-addressed (`SM-<hash8>`), so a finding that persists across runs
  keeps its id and the baseline ratchet marks it `pre-existing`. A renamed surface is the same
  finding; a coincidentally-similar new one is not.

## What drift means

- `anchors_broken > 0` in the stamped freshness is the drift verdict: code the map cites no
  longer resolves. That is a finding against the map, never a reason to quietly drop the claim.
- A finding that disappears between runs was resolved by whatever change removed its evidence —
  say which change, when you can see it, rather than just counting it gone.

## What a re-run never does

- It never invents a finding. The engine's output is the only source.
- It never softens a finding. Absence of proof is drift, not a fix.
- It never hand-edits the stamped freshness. Only the verb writes it.

## The verdict

Safe to merge only when the run exits clean and no cited anchor is broken. Blocked checks are a
gap in confidence, not a pass — surface them, do not bury them.
