# Status lines

verified: 2026-11-16

Print one line per step, before the step's work starts. Build it from `.paqad/onboarding/view.json` (external: the verbs write it in the project being onboarded), never from words you write yourself. Every `paqad-ai onboarding` verb rewrites that file, so read it after the verb that starts the step:

- While a step runs, print `status_line` as it is, for example `**▸ paqad** · Step 4 of 8 · <running phrase> · 7 of 23 · billing`.
- When `status_line` is null (between steps, or after a stop), print `**▸ paqad** ·` followed by `headline.text`.
- When `gaps` is not empty at the end, print each gap's `footnote` and `next_action` under the success summary.
- When `uncommitted_note` is set after the commit question, print it as the last line.
