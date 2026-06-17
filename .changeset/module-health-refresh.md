---
'paqad-ai': minor
---

Module health now updates instead of staying frozen at the onboarding stub.

Two changes close the gap that left every module's `.paqad/module-health/<slug>.json` reading `tier: unknown` with all metrics null after onboarding:

- The verification backstop (`runRepositoryVerification`) now folds verification reality into each touched module's health profile on every completion. This is the agent-independent chokepoint behind the Claude Stop hook and the git/CI backstop, so profiles refresh automatically with no change required in onboarded projects.
- A new `update module health` workflow (routed like `create documentation`) refreshes every module on demand. It runs a rollup then a sync across all declared modules and reports each module's resulting tier. It wraps the existing `module-health rollup` and `module-health sync` commands and adds no new CLI command.
