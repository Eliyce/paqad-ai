---
name: join
description: 'Claude Code: Set up an already-onboarded paqad project on your own machine. Builds your local RAG index if the team uses one, and changes no tracked files. Use when you cloned a repo that already has a committed .paqad/ and you are not the lead.'
compatibility: 'Claude Code with a project folder open (needs a shell)'
---

# Join an onboarded paqad project

First check where you are running. If there is no shell and no project folder open, reply in one sentence that this works in Claude Code with a project folder open, and stop. Otherwise carry on with the steps below and do not mention this check.

The project is already onboarded (it has a committed `.paqad/`). This sets up only your machine.

1. Run:

   ```
   paqad-ai join
   ```

2. If the team uses RAG, this builds your local index. It stays on your machine and is never committed. In a terminal it may confirm first; for a scripted run add `--non-interactive` to build without a prompt (or `--no-rag` to skip it).

3. It writes no tracked files. When it reports it is ready, your machine is set up.

Do not run `onboard` to join an existing project; that is the lead's command and it rewrites the team configuration.

If `paqad-ai` is not found, use `npx paqad-ai` instead.
