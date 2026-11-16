# Status lines

Print one line per step, before the step's work starts. Build it from `.paqad/onboarding/view.json`, never from words you write yourself:

- While a step runs, print `status_line` as it is, for example `**▸ paqad** · Step 4 of 8 · <running phrase> · 7 of 23 · billing`.
- Between steps, or after a stop, print `**▸ paqad** ·` followed by `headline.text`.
- When `gaps` is not empty at the end, print each gap's `footnote` and `next_action` under the success summary.
- When `uncommitted_note` is set after the commit question, print it as the last line.
