# Design review stages by step

verified: 2026-11-16

Which `paqad-ai design-review` stage wraps which part of the Procedure, and how findings and gaps are recorded. The HUD draws only what these verbs record; never write the run files by hand.

## Stage map

Start the stages in this order, one after another. A later stage never comes before an earlier one.

| N   | Stage     | Work it covers                                                                |
| --- | --------- | ----------------------------------------------------------------------------- |
| 1   | `scope`   | Step 0: the readiness gate                                                    |
| 2   | `map`     | Step 1: load the contract and derive the component and screen inventory       |
| 3   | `code`    | Step 1 helpers 2, 3 and 8, the Step 2 scripts and the Step 2.5 playbook       |
| 4   | `screens` | Step 3: the surface walk, token diff, visual regression and asset budget      |
| 5   | `tasks`   | Step 3: the state sweep, the dynamic a11y pass and the performance budget     |
| 6   | `judge`   | Step 4: grade every candidate against the contract and give it a severity     |
| 7   | `confirm` | Step 4: write `DT-XXXX` findings and record each one through the finding verb |
| 8   | `report`  | Step 5: write the report and its sidecar, then `finish`                       |

## Starting and ending the run

- `start` refuses while a run is open. When you are resuming this design-test run from its `progress.json`, carry on with the open run (`resume` it if it is stopped). Otherwise `abandon` the old run, then `start`.
- `status` prints where the run is when you are unsure.
- End every run with `finish` after Step 5, or `abandon` on a hard stop (the owner declines the docs, or the review cannot go on). `finish` counts each stage that is neither done nor skipped as a `not-run` gap.

## Findings and leads

- Record each finding as you write it: `paqad-ai design-review finding --severity <level> --proof <confirmed|lead> --id DT-XXXX`.
- Severity map from the design severity to the review level:

  | Design severity | `--severity` |
  | --------------- | ------------ |
  | blocker         | `critical`   |
  | high            | `high`       |
  | medium          | `medium`     |
  | low             | `low`        |
  | nit             | `info`       |

- Proof rule: `--proof confirmed` when the finding has its evidence (`file:line` for static, a screenshot and selector for live). A candidate whose evidence is inconclusive, or any finding with `confidence: low` (every finding of a Bare run), is `--proof lead`. A lead never raises the fail tone.

## Gaps

- Record each blocked check as a gap on its stage: `paqad-ai design-review gap <code> --stage <id> --say "<plain words>"`, for example `gap app-unreachable --stage screens --say "The app did not start, the live walk was blocked"`. Add `--stop` only when the run cannot go on.
- A gap marks its stage `gap`, so `stage <id> done` then refuses. If the rest of the stage still runs, run `stage <id> start` again and `stage <id> done` when its work ends; the gap stays counted. If nothing more of the stage can run, run `stage <id> skip`.
- When the app cannot be reached in Step 3, record the gap on `screens`, then skip `screens` and `tasks`.
- Step 0 on **Missing**: `stage scope start`, `gap missing-design-docs --stage scope --say "<words>" --stop`, then the decision pause. After `create documentation`, `resume` (never a second `start`): Scope is running again and the missing-docs gap is dropped once the docs exist. Grade again, then `stage scope done`.
