---
'paqad-ai': minor
---

Add a harness-enforced agent-entry gate so onboarded Claude Code projects can't silently bypass `CLAUDE.md` (#34). Onboarding now writes `.claude/settings.json` with two hooks:

- `PreToolUse` on `Edit|Write|NotebookEdit` runs `runtime/hooks/agent-entry-gate.sh`, which blocks the call with exit code 2 unless `.paqad/.agent-entry-loaded` exists and is newer than `CLAUDE.md`, `.paqad/framework-path.txt`, and everything under `docs/instructions/`.
- `SessionStart` runs `runtime/hooks/agent-entry-session-start.sh`, which deletes the sentinel so every new session starts ungated.

The CLAUDE.md template now instructs the agent to write the sentinel after loading the framework entry, and to re-load when the gate invalidates it. Existing settings.json keys and pre-existing hook entries are preserved on merge, and re-running onboarding is idempotent (no duplicate gate entries). Read-only tools (Read, Grep, Glob, status-only Bash) remain available pre-gate so the agent can satisfy it. AGENTS.md and other providers can re-use the same scripts in follow-ups via `PAQAD_ENTRY_FILE`.
