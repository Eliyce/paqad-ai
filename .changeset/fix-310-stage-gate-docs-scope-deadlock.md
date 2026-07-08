---
'paqad-ai': patch
---

Fix #310: the feature-development stage gate blocked documentation-only work and could deadlock unclearably.

- **Scope.** The pre-mutation and completion stage gates now govern **feature development only**. A documentation-only change (`docs/**`, markdown) or a framework-internal change (`.paqad/**`) is no longer forced through the planning → specification → … → checks stages. The check is language-agnostic (an exclude list, not a `src/` allowlist), so it holds for any onboarded stack (Laravel `app/*.php`, Python, Go, …), and it keeps full teeth on real source edits.
- **No deadlock.** The live writer no longer stamps a stage (e.g. `development`/`documentation_sync`) before the pre-code stages are recorded — that phantom used to poison stage ordering so `planning` could never be recorded again. The recorder no longer rejects an out-of-order earlier `stage_start`; ordering is judged non-destructively by the completion fold, so the stages the gate demands can always be recorded and the same-turn marker remediation actually clears the block.
- **Consistent predicate.** An `end` with no matching `start` is now `inconclusive`, not silently `complete`, so the pre-mutation gate and the completion verifier agree a stage needs a start.
- **Reachable remedy.** Editing `.paqad/configs/.config.policy` (the `stages_mode` escape hatch) is no longer blocked by the gate it configures.
