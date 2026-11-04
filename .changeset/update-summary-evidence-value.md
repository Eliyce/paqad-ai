---
'paqad-ai': patch
---

`paqad-ai update` now prints a short summary instead of a JSON report that could run past 100 KB. Run `paqad-ai update --json` for the full report. It also leaves a file alone when its content wouldn't change, so a run no longer lists unchanged files or makes a running session reload the framework.

A team that had set `evidence_existence_gate=strict` no longer gets an invalid `legacy_existence_check: strict` from the move to YAML. The value now becomes `warn`, and your next `paqad-ai update` fixes a file that already holds `strict` and tells you it did.

This release also refreshes the committed rule-binding lock, which was out of date on the last release and blocked edits on a clean checkout until it was refreshed.
