# Pipeline

How a change reaches "done". These always load.

<!-- trigger: ** -->

- Treat a change as deliverable only after `format`, `test`, and `build` all pass locally (`pnpm ci` runs all three plus lint and typecheck).
- Fix the first failing gate before you do anything else. MUST NOT stack new work on a red base.
- Keep each commit scoped to one coherent step, so a reviewer can read it and a revert can undo it on its own.

## Verify

```bash
# The whole gate in one command:
pnpm ci
# One coherent step per commit is a manual review of `git log`/`git diff`.
```
