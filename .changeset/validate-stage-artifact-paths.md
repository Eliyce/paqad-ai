---
'paqad-ai': patch
---

Validate `stage end --artifact` paths at the boundary (#350). An absolute or out-of-tree artifact path was silently `join()`ed onto the project root, resolved to a non-existent in-repo file, hashed as "absent", and folded the stage to inconclusive — while the CLI still printed `{"recorded":true}` and exited 0. Now an in-tree path (absolute or relative) normalizes to project-relative and records normally, and a genuinely out-of-tree path is rejected loudly with a clear error and a non-zero exit. The `paqad:stage <stage> end -- <path>` marker gets the same treatment so chat-driven and shell-driven marks agree. The anti-spoofing "absent" semantics for a genuinely-missing in-tree file are unchanged.
