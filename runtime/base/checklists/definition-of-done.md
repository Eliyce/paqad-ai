# Definition Of Done

"Done" is a checkable bar, not a feeling (issue #102). A feature is done when **all three** hold:

1. **Verification gates pass** — typecheck, lint, format, tests, build, and the rule-compliance gate are all green.
2. **Every frozen acceptance criterion is built and proven** — each `AC-n` in the frozen spec has a passing proof (bidirectional traceability supplies the link, issue #109).
3. **Self-review surfaces no confirmed problem** — triage (issue #107) returns no confirmed, non-taste finding.

Style and taste never block done. Taste findings are recorded and handed to triage — they are never a gate.

When the bar is not met, name the specific gap: the failing gate, the one acceptance criterion whose proof is not passing, or the confirmed finding that blocks. The `isDone()` helper (`src/spec/definition-of-done.ts`) and `renderDefinitionOfDone()` produce this verdict and name the failing item.
