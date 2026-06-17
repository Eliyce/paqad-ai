# Code Review

- Prioritize correctness, regressions, and verification gaps over style nits.
- Call out rollback and data-integrity risk explicitly.
- Treat missing, skipped, or weakened tests as blocking findings.
- Confirm the change does only what the request asked; flag scope creep and unrelated edits.
- Block any locally re-derived value that a shared helper already resolves (paths, roots, config); require the canonical helper. When two ways to compute the same thing exist, that is the bug.
