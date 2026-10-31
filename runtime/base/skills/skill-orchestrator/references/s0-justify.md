# S0 justify

verified: 2026-10-31

1. Run the candidate task three times without any skill, each in a fresh context (a fresh subagent where the host has them).
2. Save each transcript to `baseline/run-1.md`, `baseline/run-2.md` and `baseline/run-3.md` in the workspace.
3. Judge each run against the task and write `baseline/verdicts.json` as `[{run, passed, note}]`.
4. Run `paqad-ai skill justify <name>`.

A skill is justified when at least one run failed. Three passes out of three stop the pipeline: no skill is needed.

Four cases have a better home than a skill. Pass the matching flag and the pipeline stops without a skill folder:

| Case                               | Flag                                                      | Better home                         |
| ---------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| a one-off fix                      | `--exclusion one-off`                                     | fix it in this change               |
| already written down               | `--exclusion documented --documented-in <path>`           | point the agent at that file        |
| a project convention               | `--exclusion convention`                                  | the always-loaded instructions file |
| a rule that has to hold every time | `--exclusion enforceable --enforce-with <hook or script>` | a hook or a rules-as-scripts check  |

For an installed skill the entry is `paqad-ai skill improve <name>` instead: it snapshots the folder first and the snapshot is the baseline.
