# Evals Guide

Eval scenarios live in `tests/evals/scenarios/*.yml` and run against the built plugin with the fixture repository in `tests/evals/fixture-repo/`.

## Habits

- Write at least 3 scenarios per skill.
- Check properties, not wording: reply length, tables for lists, no narration, sources present, nothing posted without approval.
- Run each scenario at least 3 times; a property must hold in every run (CI-12).
- Scenarios are authored but not yet executed in CI.
