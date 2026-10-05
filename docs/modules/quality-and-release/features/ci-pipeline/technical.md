# CI and release workflows: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `.github/workflows/ci.yml` | Jobs `implemented-in-s0` and `not-yet-implemented` |
| `.github/workflows/verify.yml` | Job `not-yet-implemented` (CI-12, CI-13) |
| `.github/workflows/release.yml` | Job `not-yet-implemented` (CI-14, CI-15) |
| `.changeset/README.md` | Placeholder; no changeset entries exist |

## Data Contracts

None. Workflow YAML only.

## Script Interfaces

`ci.yml`, job `implemented-in-s0` (`ubuntu-latest`, `actions/checkout@v4`, `actions/setup-python@v5` with Python `3.9`):

| Step | Command |
|---|---|
| CI-7 script tests (partial, no coverage gate yet) | `python -m unittest discover -s tests/scripts -p "test_*.py" -v` |
| CI-8 build is deterministic | `python build/build.py --dist /tmp/dist-a`, `python build/build.py --dist /tmp/dist-b`, `diff -r /tmp/dist-a /tmp/dist-b` |

Placeholder steps (each `echo "not yet implemented (S1+)"`):

| Workflow | Steps |
|---|---|
| `ci.yml` job `not-yet-implemented` | CI-1, CI-2, CI-3, CI-4, CI-5, CI-6, CI-9, CI-10, CI-11, CI-20 |
| `verify.yml` | CI-12, CI-13 |
| `release.yml` | CI-14, CI-15 |

Exit: a step fails the job on a non-zero exit (unit test failure, build failure, or any `diff` output).

## State Management

None: stateless. CI-8 writes to `/tmp` on the runner.

## Error Codes

None of its own. Failures surface as `unittest` output, `build failed: <message>`, or `diff` output.

## Dependencies

| Kind | Detail |
|---|---|
| Other modules | plugin-build (`build/build.py`); unit-tests (`tests/scripts/`) |
| Coverage by unit tests inside CI-7 | CI-1 and CI-2 partly (`SkillFrontmatterTest`), CI-3 (`test_no_forbidden_content`), CI-4 (`NeutralWordingTest`), CI-5 (`HousePromptTest`), CI-11 (`TriggerHygieneTest`), CI-20 (`VoiceBlockTest`) |
| External, not wired | `claude plugin validate --strict`, `skills-ref validate` (CI-9); a secret scanner (CI-6); changesets tooling (CI-14) |

## Configuration

| Item | Value |
|---|---|
| `ci.yml` triggers | `pull_request`, `workflow_dispatch` |
| `verify.yml` triggers | `schedule` cron `0 3 * * *`, `workflow_dispatch` |
| `release.yml` triggers | `workflow_dispatch` |
| Python | `3.9` only (CI-7 also asks for the current Python; not configured) |
| Version | `0.0.0` from `build/skills.yml` |

Header comments in `ci.yml` and `verify.yml` still describe the S0 state ("no scenarios exist yet"), although `s1.yml` and `s1b.yml` now exist.

## Testing Entry Points

The workflows are themselves the entry points: `ci.yml` steps "CI-7 script tests (partial, no coverage gate yet)" and "CI-8 build is deterministic". Local equivalents are in `docs/instructions/registries/commands.md`.
