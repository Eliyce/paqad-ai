# Codex Entry Framework

Use this file as the repository entrypoint for Codex CLI.

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

Adapter:
codex-cli
