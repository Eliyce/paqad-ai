---
'paqad-ai': patch
---

Stage agents are recorded as started again in projects that have both the npm install and the Claude Code plugin. While the project's own settings still run the npm hooks, `paqad-ai update` now keeps those hook lines current instead of skipping them, so a newer hook such as the stage agent start reaches the project. The start hook also writes a line to the hooks log saying why it stood down, and a test checks that every hook the plugin ships has its npm counterpart.
