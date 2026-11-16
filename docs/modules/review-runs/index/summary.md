# Review Runs

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `review-runs`

## Purpose

Keeps one staged run per review, the security review (route `pentest`) and the design review
(route `design-test`), so the HUD band, the terminal card, the snapshot and `paqad-ai status` can
show which of eight stages a review is in and how it ended. It carries no scanning logic; the
`pentest` and `design-test` skills drive it through the CLI verbs.

## Kinds and stages

- `security`: verb `security-review`, word `Security review`, finding prefix `PT-`, stages Scope,
  Map, Scan, Threats, Hunt, Confirm, Sweep, Report.
- `design`: verb `design-review`, word `Design review`, finding prefix `DT-`, stages Scope, Map,
  Code, Screens, Tasks, Judge, Confirm, Report.

Route ids, finding ids and the report folders keep their old names.

## State Management

- `run.json` at `.paqad/reviews/<security|design>/run.json` is the run record. It is written only
  under the single-flight lock at `.paqad/locks/review-<kind>.lock` with a revision check; every
  accepted write raises `revision` by exactly 1, so parallel verbs never lose a write.
- `view.json` beside it is the journey-shaped view the HUD reads: kind, run id, word, status, the
  eight stage states (`todo`, `running`, `done`, `skipped`, `gap`), the current stage, the
  headline (row, text, signal), confirmed counts by severity, the lead count, the gaps, the resume
  prompt, the continue words, `finished_at` and `updated_at`. It is rewritten with an atomic swap
  after every accepted write.
- A running stage with no write for 20 minutes draws as stopped. A finished or abandoned run stays
  visible for 30 minutes, the same window onboarding uses.

## CLI verbs

`paqad-ai security-review <verb>` and `paqad-ai design-review <verb>`, each with `--json`:

- `start`: begins a new run; refuses while a run of the same kind is open.
- `stage <id> start|done|skip`: `done` needs the stage running; unknown stages refuse.
- `finding --severity <critical|high|medium|low|info> --proof <confirmed|lead>`: leads are counted
  apart and never raise the headline.
- `gap <code> --stage <id> --say <words> [--stop]`: marks the stage `gap`; `--stop` stops the run.
- `finish`: records a `not-run` gap for every stage neither done nor skipped, then finishes.
- `abandon`, `resume`, `status`. For a design review, `resume` drops the `missing-design-docs`
  gap once the design-system docs exist.

A refusal prints one plain line (or one JSON object) and exits 1; `run.json` stays unchanged.

## Source Footprint

- `src/review-runs`
- `src/cli/commands/review-run.ts`
