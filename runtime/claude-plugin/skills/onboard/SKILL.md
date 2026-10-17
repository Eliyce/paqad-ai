---
name: onboard
description: Set up paqad in this project so it enforces your team's rules at edit time and records evidence for every change. Use when the project has not been onboarded yet, or when the lead wants to (re)configure the stack, capabilities, providers, or RAG.
---

# Onboard this project with paqad

You are the project lead setting paqad up for the whole team.

1. Run the detection first so you can confirm the stack with the user before writing anything:

   ```
   paqad-ai onboard --detect --json
   ```

2. Show the user the detected stack and suggested capabilities, and confirm the providers they want. Inside Claude Code with no npm installed, only `claude-code` can be wired.

3. Run the onboard, passing what the user confirmed. For a scripted run with no terminal, pass every answer and add `--non-interactive` (it exits with `missing --<flag>` instead of hanging on a prompt):

   ```
   paqad-ai onboard --stack <stack> --capability <cap...> --providers <provider...> --rag <on|off>
   ```

4. Commit the generated `.paqad/` and the per-provider entry files so the rest of the team inherits the setup. Teammates then run the `join` skill, not `onboard`.

If `paqad-ai` is not found, use `npx paqad-ai` instead.
