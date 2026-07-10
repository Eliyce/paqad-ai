# Constitution

Non-negotiable rules that apply to every change, in every stack. These always load.

<!-- trigger: ** -->

- Before you edit an area, read its module and feature docs under `docs/`, and update those same docs in this change when behavior changes. A behavior change that leaves its docs stale is unfinished.
- Change only what the request requires. MUST NOT refactor, reformat, rename, or reorder unrelated code in the same change.
- MUST NOT overwrite or delete a user-authored file without an explicit instruction to do so.
- Pair every behavior change with a test that exercises it, and run that test before you call the work done.
- When a requirement is ambiguous, or an action is risky or hard to reverse, stop and ask. MUST NOT guess and proceed.

## Verify

```bash
# Scope — the diff touches only files the request names (review the list):
git diff --name-only
# Tests moved with the code — a src/ change should show a matching test change:
git diff --name-only | grep -qE '(^|/)src/' && git diff --name-only | grep -qE '(test|spec|__tests__)'
# No unexplained deletions of user-authored files:
git diff --diff-filter=D --name-only
# Ambiguity or risk was raised as a Decision Pause, not silently guessed (manual review).
```
