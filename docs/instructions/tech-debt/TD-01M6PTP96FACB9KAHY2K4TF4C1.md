---
id: "TD-01M6PTP96FACB9KAHY2K4TF4C1"
title: "assemble-plugin does nothing and exits 0 when started through a linked folder"
kind: "bug"
severity: "low"
status: "open"
files:
  - "scripts/assemble-plugin.mjs"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T21:43:56.845Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`isDirectRun` at scripts/assemble-plugin.mjs:225-229 compares `import.meta.url` with the unresolved argv path. Started through a linked folder, the script does nothing and exits 0: I ran `node <link>/assemble-plugin.mjs <out>` and got exit 0, no output and no out folder. scripts/check-plugin-tree.mjs had the same check and now compares real paths. The same check is on main at b3039234, lines 155-158, so this change did not add it. The release job at .github/workflows/release.yml:167 and the CI step at .github/workflows/ci.yml:121 start it directly and are not linked today, so the risk is low. Compare real paths here too, and add a test like the one for check-plugin-tree in tests/unit/plugin/assemble-plugin.test.ts.
