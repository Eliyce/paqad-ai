---
'paqad-ai': patch
---

The last users of the retired changed-files cache now read git instead (#651).

- The generated `scripts/refresh-registry-diff.sh` takes its changed files from `git status` plus everything committed on the branch since it left `main`. Before, it looked for a cache file nothing writes, so it always ran the full refresh. It still runs the full refresh outside git or when git reports no changes.
- The `diff-doc-sync` skill reads the changed files from `paqad-ai review digest` (or git) instead of the cache.
- The unused `track-file-changes.sh` hook script, which no hook config ever ran, is gone.
