# Claude Entry Framework

Use this file as the repository entrypoint for Claude Code.

Before handling repository work:
1. Open `.paqad/framework-path.txt`.
2. Resolve the reference inside that file and load the framework entry it points to.
3. Load `docs/instructions/rules`, `docs/instructions/stack`, and `docs/instructions/design-system`.
4. Treat those sources as the canonical project contract for workflow routing, documentation, and implementation behavior.
5. Once steps 1–4 are complete, write `.paqad/.agent-entry-loaded` with a JSON payload of `{ "loaded_at": "<ISO timestamp>", "entry_file": "CLAUDE.md", "framework_version": "<resolved version>" }`. The Paqad PreToolUse gate blocks Edit/Write/NotebookEdit until this sentinel exists. Read-only tools (Read, Grep, Glob, status-only Bash) remain available before the sentinel is written so you can complete steps 1–4.

The sentinel is invalidated automatically if `CLAUDE.md`, `.paqad/framework-path.txt`, or any file under `docs/instructions/` changes mid-session — re-do steps 1–5 when that happens.

Workflow handling:
- Interpret short Paqad workflow prompts such as `create documentation` as workflow invocations.
- Do not ask the user to choose a document type when a Paqad workflow already matches the request.
- Generate or update the canonical project documentation and registries defined by Paqad instead of defaulting to generic templates.

## paqad in your chat

See `.paqad/narration-contract.md` for the full voice spec, cadence detail, and the plain-English translation of every internal term.

## Decision Pause Contract

See `.paqad/decision-pause-contract.md` for the full rule, categories, resolution flow, and fallback.

In Claude Code, surface the packet via `AskUserQuestion` and wait for the answer.

Adapter:
claude-code
