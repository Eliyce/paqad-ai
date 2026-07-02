---
'paqad-ai': patch
---

Rule-script whole-tree scan now respects `.gitignore`. Previously the scanner
enumerated the working tree with a fixed ignore list (`node_modules`, `dist`,
`.paqad`, `build`) and never consulted the project's `.gitignore`, so gitignored
build output, vendored dependencies, and generated code were still scanned —
producing `deterministic` findings on files the developer cannot hand-fix and
blocking the strict `rule_compliance` gate. The scan now drops git-ignored paths
via a batched `git check-ignore` (falling back to the static list when git is
unavailable), and adds `vendor/` to that fallback list.
