---
name: onboard
description: "Claude Code: Set up paqad in this project as one onboarding journey: one question about the team's AI tools, then eight steps that run without stopping, ending with one commit question. Use when the project has not been onboarded yet, after the /paqad onboard tray, or to resume an onboarding journey."
compatibility: 'Claude Code with a project folder open (needs a shell)'
disable-model-invocation: true
---

# Onboard this project with paqad

If there is no shell and no project folder open, reply in one sentence that this works in Claude Code with a project folder open, and stop. Otherwise follow the steps and do not mention this check.

You are the project lead setting paqad up for the whole team.

1. If the arguments contain `--resume`, or `.paqad/onboarding/journey.json` exists, run `paqad-ai onboarding resume` and go to step 4.
2. If the arguments came from the `/paqad onboard` tray (they name the tools, `--session <id>` and `--allow-list yes|no`), run `paqad-ai onboarding start --from-tray --providers <tools> --session <id> --allow-list <yes|no>` and go to step 4.
3. Otherwise ask one AskUserQuestion with two questions: "Providers" (which AI tools the team uses; Claude Code ticked by default) and "Permissions" ("Let it work without stopping to ask", ticked by default). Never ask for the stack. If the person dismisses it, stop and start nothing. Then run `paqad-ai onboarding start --asked --providers <tools> --allow-list <yes|no>`.
4. Hand over to the `onboarding-journey` skill's loop: run `paqad-ai onboarding next` and do what each brief says until it asks the commit question.

If `paqad-ai` is not found, use `npx paqad-ai` instead.
