# S7 release

verified: 2026-11-01

Run `paqad-ai agent release <name>`. It refuses while a gate has no passing record or override, and when the agent or a hook script it names changed after the stage that judged it.

It writes the agent in each enabled host format (Markdown for Claude Code, TOML for Codex), the SDK form `<name>.agent.json`, `evidence.json` and `CHANGELOG.md`, and the bundle record `agent-<name>.json`. A host that runs no subagents, or a form that would drop a restriction the agent relies on, gets no file and is recorded not deployable, with a skill proposed. A plugin agent moves its must-not rules to SubagentStart and SubagentStop settings hooks.

To skip a gate, ask with `paqad-ai agent override <name> <stage> --reason "<why>"`, then record it with `--decision <id>`. The agent is labelled unverified.
