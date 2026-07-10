# Code Review

- Prioritize correctness, regressions, and verification gaps over style nits. <!-- @rule RL-b71c -->
- Call out rollback and data-integrity risk explicitly. <!-- @rule RL-66f6 -->
- Treat missing, skipped, or weakened tests as blocking findings. <!-- @rule RL-73cb -->
- Confirm the change does only what the request asked; flag scope creep and unrelated edits. <!-- @rule RL-3b88 -->
- Block any locally re-derived value that a shared helper already resolves (paths, roots, config); require the canonical helper. When two ways to compute the same thing exist, that is the bug. <!-- @rule RL-8ea0 -->
