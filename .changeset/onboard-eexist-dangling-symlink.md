---
'paqad-ai': patch
---

Fix `onboard` crashing with `EEXIST: file already exists, symlink` when a previous run left a dangling framework symlink (e.g. the npx cache directory it pointed at was garbage-collected). `ensureFrameworkSymlink` now detects the link with `lstat` instead of `existsSync` so dangling symlinks are cleaned up and replaced idempotently.
