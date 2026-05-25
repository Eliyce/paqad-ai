---
'paqad-ai': patch
---

Stop emitting the hardcoded `Categories:` block in provider entry files (#54). `buildDecisionPauseContractSection()` now renders just the Decision Pause Contract paragraph — no `Categories:` heading, no fixed five-item bullet list. `extractDecisionPauseContractSection` still parses entry files that previously contained the block (back-compat), and the existing drift health check flags the legacy block so re-running onboarding / refresh strips it from already-onboarded projects.
