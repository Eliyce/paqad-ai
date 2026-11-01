---
name: onboard
description: "Claude Code: Set up paqad in this project so it enforces your team's rules at edit time and records evidence for every change. Use when the project has not been onboarded yet, or when the lead wants to (re)configure the stack, capabilities, providers, or RAG."
compatibility: 'Claude Code with a project folder open (needs a shell)'
---

# Onboard this project with paqad

First check where you are running. If there is no shell and no project folder open, reply in one sentence that this works in Claude Code with a project folder open, and stop. Otherwise carry on with the steps below and do not mention this check.

You are the project lead setting paqad up for the whole team.

1. Run the detection first so you can confirm the stack with the user before writing anything:

   ```
   paqad-ai onboard --detect --json
   ```

2. Show the user the detected stack and suggested capabilities, and confirm the providers they want. Inside Claude Code with no npm installed, only `claude-code` can be wired.

   If the detection returns `"detected_stack": null` (common for a plain `package.json` project that matches no specific framework), do not guess. Ask the user which stack fits and pass it explicitly as `--stack` in step 3: for a Node project that is usually `node-library`, `node-cli`, or `node-service`. A bad `--stack` value is rejected with the list of valid stacks.

3. Run the onboard, passing what the user confirmed. For a scripted run with no terminal, pass every answer and add `--non-interactive` (it exits with `missing --<flag>` instead of hanging on a prompt):

   ```
   paqad-ai onboard --stack <stack> --capability <cap...> --providers <provider...> --rag <on|off>
   ```

4. Commit the generated `.paqad/` and the per-provider entry files so the rest of the team inherits the setup. Teammates then run the `join` skill, not `onboard`.

If `paqad-ai` is not found, use `npx paqad-ai` instead.
