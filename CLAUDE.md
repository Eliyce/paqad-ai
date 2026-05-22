# Claude Entry Framework

Use this file as the repository entrypoint for Claude Code.

Before handling repository work:
1. Open `.paqad/framework-path.txt`.
2. Resolve the reference inside that file and load the framework entry it points to.
3. Load `docs/instructions/rules`, `docs/instructions/stack`, and `docs/instructions/design-system`.
4. Treat those sources as the canonical project contract for workflow routing, documentation, and implementation behavior.

Workflow handling:
- Interpret short Paqad workflow prompts such as `create documentation` as workflow invocations.
- Do not ask the user to choose a document type when a Paqad workflow already matches the request.
- Generate or update the canonical project documentation and registries defined by Paqad instead of defaulting to generic templates.

## Decision Pause Contract

Before implementing any choice that falls into one of these categories, write a Decision Packet to `.paqad/decisions/pending/D-{N}.json` and stop work. Do not continue until `.paqad/decisions/resolved/D-{N}.json` exists.

Resolution flow (Claude Code):
1. Write the packet to `.paqad/decisions/pending/D-{N}.json`.
2. Present the packet's options to the user via the in-chat question UI (`AskUserQuestion`). If multiple packets are pending, ask them one at a time in numeric order. If a packet has more than 4 options, present the top 4 — the user can pick "Other" to write in an alternative.
3. When the user answers, move the file from `.paqad/decisions/pending/D-{N}.json` to `.paqad/decisions/resolved/D-{N}.json`, adding these fields to the JSON: `chosen` (the selected option id or label), `rationale` (any free-text note the user added), and `resolved_at` (ISO 8601 timestamp).
4. Only after the resolved file exists may implementation continue.

Fallback: if the interactive UI is not available (non-interactive run, hook context, etc.), stop work and wait until `.paqad/decisions/resolved/D-{N}.json` exists — created out of band by the user.

Adapter:
claude-code
