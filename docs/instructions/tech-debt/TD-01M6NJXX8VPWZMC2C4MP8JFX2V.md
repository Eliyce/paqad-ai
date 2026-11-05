---
id: "TD-01M6NJXX8VPWZMC2C4MP8JFX2V"
title: "A committed agent copy from another plugin version reads as hand-edited"
kind: "bug"
severity: "medium"
status: "open"
files: []
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "documentation_sync"
found_by: "paqad-development"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-05T10:09:03.739Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

A committed `.claude/agents` copy of a paqad agent is compared with the text of the plugin that is running. When the two differ, the copy reads as hand-edited.

That comparison is wrong when nobody edited the file:

- A teammate on another plugin version opens the project. Their plugin renders different agent text, so the committed copy looks changed.
- The plugin updates in the middle of a change. The copy committed earlier no longer matches the new text.

In both cases the person sees a false "changed but never went through its checks".

Likely repair: also accept the agent bodies of known past releases, so a copy that matches any released text does not read as hand-edited. Only text that matches no release should raise the finding.
