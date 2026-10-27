# Coverage Guide

Branch coverage is measured with `coverage.py`. It is a development and CI tool only. It is never imported by shipped scripts, so the standard-library-only rule for `skills/` and `shared/` still holds.

## Install

`python3 -m pip install coverage`

## Commands

| Goal | Command |
|---|---|
| Run the suite under coverage | `python3 -m coverage run --branch --source=build,shared/scripts,skills -m unittest discover -s tests/scripts` |
| Gate at 95% | `python3 -m coverage report --fail-under=95 --show-missing` |
| XML for the stack pack | `python3 -m coverage xml -o coverage.xml` |
| HTML to browse gaps | `python3 -m coverage html -d coverage-html` |

## Notes

- The bar is 95% branch coverage across `build/`, `shared/scripts/` and `skills/*/scripts/`.
- Keep `.coverage`, `coverage.xml` and `coverage-html/` out of git.
- REQUIREMENTS.md CI-7 still states 90%; the 95% rule supersedes it once CI enforces it.
