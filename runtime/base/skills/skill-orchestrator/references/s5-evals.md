# S5 evals

verified: 2026-10-31

1. Write at least two cases under `evals/<case>/` in the workspace, each with `prompt.md` and one grader file per criterion under `evals/<case>/graders/`, and mark one edge case with `edge: true` in its `case.yaml`. claude plugin eval reads that file too, so give it `schema_version: "1.0"` and `name: <case>` as well.
2. Run `paqad-ai skill eval plan <name>`. It picks the adapter (claude plugin eval, subagent dispatch, or none), writes the case folders and prints the exact commands per model tier, with the run count and the worst-case spend.
3. Run what it prints. Every run starts in a fresh context. For subagent dispatch, save an outputs folder, `transcript.md`, `grading.json` and `timing.json` (tokens, duration, model) in each run folder as soon as the run reports.
4. Write the assertions after the first outputs exist. Grade mechanical ones by script and the rest with the grader brief.
5. Run `paqad-ai skill eval record <name>`. It refuses a partial iteration and names the missing runs.

For a new skill the gate passes on a pass-rate gain of at least `skill_eval_min_gain_points` over the baseline (for a subjective skill, the blind comparator prefers the revised skill on every case). In improve mode it passes when the pass rate falls no more than `authoring_regression_tolerance` (a share: 0.2 is 20 points) below the old skill, so an edit that keeps the behaviour the same can pass. Both need median tokens within the configured multiple. Where the host reports no tokens, the token checks are recorded as not measured.

Revise from the feedback: generalise, cut what does not pull its weight, explain the why, bundle a helper written twice. Each revision is a new iteration. The loop stops on empty feedback (`--feedback-empty`), after two iterations with no improvement, or at the iteration cap.
