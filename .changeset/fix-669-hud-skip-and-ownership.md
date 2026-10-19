---
'paqad-ai': patch
---

Fixed the status line showing "Safe to merge" after a turn whose end-of-turn check was skipped. A skipped check now leaves the last real verdict on screen. A turn in which only the stage agents edited files is now checked as the orchestrator session's own work, and a prompt that names a stage, such as "run documentation_sync", keeps an open change on feature development instead of turning it into a docs, question or no-workflow turn. A specialist request such as a security review still goes to its own workflow.

The bundle receipt.json is now sealed after every check has run, so its result matches the verdict on the status line. A quality measure that could not be taken, for example because there is no coverage report, is still listed on the receipt but no longer makes it read Inconclusive.
