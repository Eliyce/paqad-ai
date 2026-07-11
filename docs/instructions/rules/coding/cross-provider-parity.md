# Cross-Provider Parity

paqad ships one behavior to the 10+ host agents in `ADAPTER_TYPES` (claude-code, codex-cli, gemini-cli, cursor, windsurf, github-copilot, junie, continue, antigravity, aider). A capability wired into a single host's hooks silently does nothing on the others: the class of bug where the evidence ledger was produced under Claude Code only, because only `ClaudeCodeAdapter` rendered the completion hook. These rules keep agent-facing behavior at parity. Entry files stay out of it; see `agent-entry-files.md`. Specific to this repo (paqad-ai).

- Wire host-triggered behavior in two tiers, in order: first the host's own native hook system (the way Claude Code's `Stop` hook already works); then, only for a host with no native hook, paqad's provider-independent git/CI backstop (`runtime/scripts/verify-backstop.mjs`) running the same `runRepositoryVerification`. MUST NOT rely on an entry-file prompt instruction as the trigger. <!-- @rule RL-40fd -->
- Render a completion-time write (evidence ledger, receipts, module-health) into every hook-capable host's real hook file from one shared definition in `src/adapters/shared/native-completion-hook.ts`: Claude `.claude/settings.json` `Stop`, Codex `.codex/hooks.json` `Stop`, Gemini `.gemini/settings.json` `AfterAgent`. MUST NOT leave it in `ClaudeCodeAdapter` alone. <!-- @rule RL-93cf -->
- Verify each host's hook surface against that host's own documentation before wiring it, and never invent an event name, config-file path, or schema. Cover a host with no native hook surface (aider, antigravity) with the git/CI backstop, not a hook. <!-- @rule RL-0e00 -->
- Point a non-Claude completion hook at the record-only script (`runtime/hooks/verification-record.mjs`, `PAQAD_COMPLETION_RECORD_SCRIPT`), which writes the ledger but always exits 0 and stays silent, so a host that reads a Stop hook's exit code or stdout as a control decision is never disrupted. <!-- @rule RL-5616 -->
- When an adapter overrides `generateConfig`/`installHooks` to emit a host config file, write the real file the host executes and send the base `installHooks` sidecar metadata to a paqad-internal path (for example `.codex/settings.hooks.json`), so the two never collide. <!-- @rule RL-f117 -->
- MUST NOT close a host-trigger gap by editing a prose entry file (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`) or its template under `runtime/templates/agent-configs/`. Host triggers belong in the hook layer, invisible to the user. <!-- @rule RL-dbc2 -->

## Verify

```
tests/unit/adapters/completion-hook-parity.test.ts asserts every hook-wired host emits the hook in
its native config and NOT in its entry file. A capability without such a test is treated as
single-host until one exists.
```
