# Code Review

What a review blocks on, in priority order. Loads for code changes.

<!-- trigger: ** -->

- Weight correctness, regressions, and verification gaps above style nits.
- Call out rollback and data-integrity risk explicitly, and say how to undo the change.
- Block missing, skipped, or weakened tests. Treat them as defects, not nits.
- Confirm the change does only what the request asked, and flag scope creep or unrelated edits.
- Block any locally re-derived value that a shared helper already resolves (path, root, config), and require the canonical helper. Two ways to compute the same thing is the bug.
