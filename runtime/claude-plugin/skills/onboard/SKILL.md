---
name: onboard
description: "Claude Code: Opens the one-click paqad onboarding journey: takes the /paqad onboard tray answer or asks one question about the team's AI tools and the allow list, starts or resumes the journey, then hands over to the onboarding-journey loop that runs the eight steps up to one commit question. Use when the project has not been onboarded yet, after the /paqad onboard tray, or to resume an onboarding journey."
compatibility: 'Claude Code with a project folder open (needs a shell)'
disable-model-invocation: true
---

# Onboard this project with paqad

If there is no shell and no project folder open, reply in one sentence that this works in Claude Code with a project folder open, and stop. Otherwise follow the steps and do not mention this check.

You are the project lead setting paqad up for the whole team. This skill only opens the journey; the eight steps live in the `paqad-ai onboarding` verbs and the `onboarding-journey` skill.

1. **Resume.** If the arguments contain `--resume`, or `.paqad/onboarding/journey.json` exists, run `paqad-ai onboarding resume` and go to step 4. Never start a second journey.
2. **Tray answer.** If the arguments name the tools with `--session <id>` and `--allow-list yes|no` (the tray sends `/paqad:onboard claude-code,codex-cli --session <id> --allow-list yes`), run `paqad-ai onboarding start --from-tray --providers <tools> --session <id> --allow-list <yes|no>` with those values as given, ask nothing, and go to step 4.
3. **One question.** Otherwise call AskUserQuestion once, with exactly these two questions and nothing else:
   - header `AI tools`, "Which AI tools does your team use?", `multiSelect: true`, options `Claude Code (Recommended)`, `Codex`, `Cursor`, `Gemini CLI`.
   - header `Permissions`, "Let paqad work without stopping to ask?", options `Allow for this project (Recommended)` (a local, git-ignored allow list for paqad commands and writes under `docs/` and `.paqad/`) and `Ask me each time`.

   Never ask for the stack: step 1 of the journey detects it. If the person dismisses the question, stop, run nothing and write nothing. Otherwise map the tools to ids (`claude-code`, `codex-cli`, `cursor`, `gemini-cli`; an "Other" answer to its id, such as `windsurf`) and run `paqad-ai onboarding start --asked --providers <ids> --allow-list <yes for Allow, no for Ask>`.

4. **Hand over.** Follow the `onboarding-journey` skill from its loop (it skips its own opening question, which is answered): run `paqad-ai onboarding next` and do what each brief says, in the same turn, until it says to ask the commit question. Ask it once and end the turn.

Checklist:

- [ ] resumed, or started once with `--from-tray` or `--asked`
- [ ] at most one AskUserQuestion, two questions, no stack question
- [ ] `paqad-ai onboarding next` looped until the commit question

## Output

```markdown
**▸ paqad** · Onboarding started for <tools>. (or the resume line `paqad-ai onboarding resume` prints)
<the onboarding-journey status lines, one per step>
Commit these changes on a new branch?
```

## Gotchas

- `--asked` is recorded as agent-attested, so pass it only after the person answered the question in this turn. The tray path passes `--from-tray` instead, never both.
- `start` refuses a tool name that is not a paqad id; it lists the ids to use.
- The commit question is never answered for the person: `paqad-ai onboarding commit` runs only with their answer.
- Teammates on a project that is already onboarded run the `join` skill, not this one.

If `paqad-ai` is not found, use `npx paqad-ai` instead.
