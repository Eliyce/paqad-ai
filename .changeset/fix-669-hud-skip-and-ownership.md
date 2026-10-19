---
'paqad-ai': patch
---

Fixed the status line showing "Safe to merge" after a turn whose end-of-turn check was skipped. A skipped check now leaves the last real verdict on screen. A turn in which only the stage agents edited files is now checked as the orchestrator session's own work, and a prompt that names a stage, such as "run documentation_sync", keeps an open change on feature development.
