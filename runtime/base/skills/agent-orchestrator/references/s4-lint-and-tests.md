# S4 lint and tests

verified: 2026-11-01

1. Run `paqad-ai agent lint <file>` while drafting; it checks AG-001 to AG-022.
2. Write the hook script tests under `tests/agents/<name>/`: one test that the script blocks, one that it allows, one for invalid input.
3. Run `paqad-ai agent test <name>`.

Powers need the owner: `bypassPermissions` (AG-015), more tools than `agent_max_tools` (AG-018), and `WebFetch`, `WebSearch` or an open `Bash` with no blocking hook (AG-022). The verb raises one `authoring.agent_permission` packet listing them; S4 waits for it. The approval binds the agent text and its hook scripts, so it still holds on the released file and an edit to either needs a new one. An override never clears these, and nothing clears a secret (AG-012).
