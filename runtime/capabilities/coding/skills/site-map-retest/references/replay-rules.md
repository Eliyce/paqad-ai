# Replay rules

A retest is a replay, not a re-audit. Its whole value is that it answers one question honestly —
did the prior findings get fixed, or did the map drift — without moving the goalposts. These are
the rules that keep it honest.

## Match by stable id, never by label

- Every finding is matched to the fresh scan by its content-addressed `SM-` id, not by category
  or surface label. A renamed surface is the same finding; a coincidentally-similar new one is
  not.

## The three statuses

- **still-open** — the finding's id reproduces in the fresh scan. The gap is still there.
- **fixed** — a deterministic finding's id is gone from the fresh scan. The gap is resolved.
- **needs-manual-verification** — an ai-judged finding's id is gone. A deterministic re-scan
  cannot re-derive an ai-judged finding, so its absence is not proof of a fix. A human confirms.

## What a retest never does

- It never invents a new finding. A problem the source report did not contain is out of scope —
  run a fresh `site-map` audit for those.
- It never lowers a finding's severity. Severity belongs to the source report; the retest only
  updates status.
- It never calls the absence of proof a fix. A surface whose cited evidence no longer resolves is
  `still-open` drift, not `fixed`.

## The verdict

Safe to merge only when nothing is still-open. A `needs-manual-verification` count is a gap in
confidence, not a pass — surface it, do not bury it.
