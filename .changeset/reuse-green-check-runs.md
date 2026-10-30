---
'paqad-ai': minor
---

`paqad-ai checks run` now reuses a green build and test run when the files are exactly the same: the newest real run of each exact command must have passed on the same tree, lockfile, Node version and build output, otherwise everything runs for real (`--no-reuse` always does). Format and lint still run every time, and format runs on just the changed files when the pack can prove it is the same formatter. The completion gate now reads a checks report written for different files as Inconclusive, the speed report counts reused runs apart, and hand edits into `.paqad/checks` are refused.
