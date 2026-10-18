---
'paqad-ai': patch
---

Changed files now come from git only (#646), and a test cleanup flake is gone (#649).

- paqad no longer reads `.paqad/session/changed-files.json`. Nothing writes that file any more, and a leftover copy with one still-dirty entry used to hide every other file you edited, so `paqad-ai review digest` and the completion checks could describe a single file out of a dozen. The changed files are now what git reports: your working-tree changes plus everything committed on the branch since it left `main` or `master`. A leftover cache file is simply ignored.
- When git cannot tell where the branch started (no `main` or `master` branch, or no commits yet), paqad uses the working-tree changes alone. Outside a git repository there are no changed files.
- Module-health session evidence, the differential refresh in `paqad-ai refresh`, and traceability read the same git list. A clean tree with no commits on the branch now means no changed files for them, where a missing cache file used to.
- Tests that run the prompt gate now remove their temporary project with retries, so the background context refresh still writing into it can no longer fail the cleanup with `ENOTEMPTY`.
