# Merge policy

Assembly folds freshly modeled layers into the committed map. The map is a living document that
humans curate, so the merge must never silently erase that curation. This reference is the
conflict-resolution contract.

## Precedence

- **Locked, human-curated content wins.** A surface title, a journey framing, or a deliberate
  exclusion a human authored is preserved over a re-derived value from a new run.
- **New, evidenced entries are added.** A surface the extractor newly proved and no committed
  entry covers is added (the `SM-ADD` reconciliation).
- **A genuine change is surfaced, not applied.** When a fresh layer disagrees with a curated
  entry — a surface moved, a guard changed — that is a conflict to report for a human decision,
  not an overwrite to perform.

## What assembly never does

- It never hand-edits `app-map.yaml`. The compile verb owns the file's shape and schema; assembly
  drives the verb and reads its result.
- It never resolves a conflict by discarding curated content. If the map and the code truly
  disagree, the disagreement is the finding.
- It never writes a map that failed schema validation. An invalid map is not a map.

## Reading the reconciliation

- `added` — new evidenced entries the committed map lacked.
- `preserved` — curated entries kept intact despite a re-derived alternative.
- `conflicts` — real disagreements between code and curation, each carrying the evidence and the
  curated value, for a human to settle.
