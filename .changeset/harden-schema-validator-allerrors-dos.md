---
'paqad-ai': patch
---

Close two CodeQL high-severity findings surfaced on the evidence/decision paths:

- **Resource exhaustion (`js/resource-exhaustion-from-deep-object-traversal`)** — `SchemaValidator` no longer sets ajv `allErrors: true`, so validation short-circuits at the first error instead of traversing an entire (potentially deeply nested, caller-influenced) object to collect every error. `verbose` is retained so error output still carries the offending value; results now report the first failure rather than all of them.
- **File-system race (`js/file-system-race`)** — the legacy decision-id migration's `remapIndex` dropped its `existsSync` check-then-`writeFileSync` sequence, which was a time-of-check/time-of-use race. It now relies on the existing `try/catch` (a missing index throws `ENOENT`, treated as "nothing to remap"), with identical behaviour and no race window.
