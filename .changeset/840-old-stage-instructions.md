---
'paqad-ai': patch
---

`paqad-ai update` no longer pins paqad's own old stage instructions into `feature-development/workflow.yaml`. It removes any instruction or read path paqad once shipped for that stage, including `docs/modules/**` and `docs/instructions/**`, and prints one line for each. Only the line goes, never a file or folder, and anything paqad never shipped stays. To keep a removed line, reword it, because the same wording is removed again on the next update. Commit the file afterwards so teammates don't repeat the change.

`update` also drops deleted paqad files from the onboarding manifest and lists `ai_attribution` as commented lines in `git-workflow/commits.yaml`.
