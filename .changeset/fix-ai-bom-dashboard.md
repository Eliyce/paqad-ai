---
'paqad-ai': patch
---

Fix the AI bill of materials on the dashboard.

Two problems made the BOM unreadable. First, `git status --short` parsing left-trimmed each line before slicing the status columns, which dropped the first character of every worktree-only changed path (`package.json` became `ackage.json`). That corrupted the BOM component names, their file digests, and the change-completeness gate messages. Second, the dashboard BOM panel only showed a file count, never the files themselves. The panel now lists every attested file with its SHA-256 digest, and shows a clear empty state when the latest verified change touched no files.
