---
'paqad-ai': patch
---

Fixed `paqad-ai checks run` reporting into the wrong change and printing "0 tests" for a passing run. It now uses `SE_SESSION` before `CLAUDE_SESSION_ID`, the same order as every other paqad command, so a stage agent's report lands in the orchestrator's change. The test count reads vitest's nested TAP output, a passing run with no countable tests says "count unavailable", and new pnpm projects get `pnpm test --reporter=tap` without the `--` that made vitest ignore the reporter.
