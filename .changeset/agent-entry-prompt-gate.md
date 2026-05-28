---
'paqad-ai': minor
---

Gate every agent turn on the entry-file load, not just code-mutating tool
calls. Onboarded projects previously could answer read-only prompts (Q&A,
"what is this project", explanations) without loading `CLAUDE.md`,
`.paqad/framework-path.txt`, or `docs/instructions/{rules,stack,design-system}`
— the framework's rules and Decision Pause Contract silently never entered
context.

The Claude Code adapter now installs a `UserPromptSubmit` hook
(`runtime/hooks/agent-entry-prompt-gate.sh`) alongside the existing
`PreToolUse` hook. Both gates share sentinel-freshness logic via
`runtime/hooks/lib/agent-entry-sentinel.sh` so they cannot drift.

Soft mode (default): the hook prints a high-priority reminder on stdout; Claude
Code injects it into the model context before the turn is planned. Hard mode
(`PAQAD_AGENT_ENTRY_MODE=hard`): the hook exits non-zero and blocks the turn
until the sentinel is written.

Re-running onboarding / `paqad upgrade` refreshes the wiring in
`.claude/settings.json` idempotently. Resolves Eliyce/paqad-ai#74.
