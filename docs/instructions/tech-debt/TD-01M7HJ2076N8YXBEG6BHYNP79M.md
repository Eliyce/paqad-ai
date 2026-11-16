---
id: "TD-01M7HJ2076N8YXBEG6BHYNP79M"
title: "Rules discovery apply writes rules after Verify and topic files with no trigger"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/rule-scripts/editor.ts"
  - "src/rules-discovery/apply.ts"
found_in:
  change: null
  issue: null
  stage: null
found_by: "orchestrator"
session: "7f9f31a9-4447-5b01-a192-8d0f55ad2feb"
created_at: "2026-11-16T06:52:33.276Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`paqad-ai rules discovery apply` writes new rules in the wrong shape, found on the first run in this repo:

1. `addRule` in `src/rule-scripts/editor.ts` always appends the bullet at the end of the file. In a rule file that ends with a `## Verify` section, the new rule lands after the Verify code block. The `rule-editor` skill shares `addRule` and has the same problem.
2. A `new` row with no fitting file creates `docs/instructions/rules/project/<topic>.md` as bare bullets, with no `# Title` and no `<!-- trigger: -->` line. `extractTriggerPatterns` in `src/planning/rule-compiler.ts` then guesses the scope from backticked paths in the rule text.

The outputs were corrected by hand in this repo. The code still produces them.

## Expected

- `addRule` puts the bullet right after the last line carrying an `@rule RL-` marker, and only appends at the end when the file has none. It must handle a bullet that runs over several lines and a marker inside a fenced block.
- When apply writes a rule file, it ensures the file has a `# <Title from the topic slug>` heading and a trigger line, and never adds them twice. This covers older topic files without them too (owner answer).
- Apply takes the trigger from where the row's packages are declared in `stack-inventory.json`: `<folder>/**` when all of them sit in one sub-folder, otherwise `**`. A root, split, missing or nested manifest also gives `**`.
- `editor.ts` takes a ready title and trigger and never reads the inventory; working out the trigger stays in `src/rules-discovery/apply.ts`.
- Rule ids and text never change, and `rule_files_hash` is refreshed.

Expert review (product-owner, application-architect, user-flow-writer, qa-engineer, skill-orchestrator, chief architect) agreed on the points above. The tests to change are `tests/unit/rule-scripts/reconciler-editor.test.ts` and `tests/unit/rules-discovery/apply.test.ts`; the AC-69 test reads line 0 of a new file as the rule line.
