---
'paqad-ai': minor
---

Make the feature-development `checks` stage fast without lowering the bar (#554, closes #505).

The check runner now executes each mapped command as a quote-aware `&&` argv chain (in-process `mkdir -p`, no shell interpretation), captures stdout, and parses the test command into per-test results — so a profile command like `mkdir -p .paqad/test-results && ./vendor/bin/pest …` can no longer report green without running a test. The test suite runs with the runner's own parallel mode when the project has it (detected per runner from the stack pack and the ecosystem lockfile, recorded in the project profile and the stack doc, with a sequential fallback for small machines and harness failures — paqad installs nothing). Check commands are overlapped by a scheduler (formatters first, build before test, everything else concurrent), and every failure under parallel is confirmed alone before it blocks: fails-alone blocks with test name, file and line; passes-alone is quarantined in the flaky registry and never blocks. New `checks_parallel`, `checks_max_processes` and `checks_flaky_under_parallel` knobs, a doctor check, a `checks plan` / `checks record-runner` verb pair, and a Checks section on the feature report page. Everything at runtime is deterministic; no LLM call from Node.
