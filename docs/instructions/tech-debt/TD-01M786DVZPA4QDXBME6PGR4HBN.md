---
id: "TD-01M786DVZPA4QDXBME6PGR4HBN"
title: "Criteria mapping does not read Python test names or docstrings"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/traceability/change-map.ts"
found_in:
  change: "01M77Y10DBA2ZPCGAA0GTC0QF4"
  issue: "890"
  stage: null
found_by: "orchestrator"
session: "08836cd6-d63d-4462-b84b-03f79333848d"
created_at: "2026-11-12T15:36:09.424Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The acceptance-criteria test mapping has two blind spots for tests outside the repo-root `tests/` folder and for Python tests.

1. `isTestFile` counts a file as a test only when its path starts with `tests/`, contains `/__tests__/`, or ends in `.test` or `.spec` with a JS or TS extension. A Python test in a nested folder such as `plugins/<name>/tests/test_x.py` is never scanned, even with an `@obligation` tag.
2. In the files it does scan, it reads only `it`, `test`, `describe`, `suite` and `context` call titles and `@obligation` tags. Python `def test_*` names and docstrings are not read.

Today a change whose criteria are proven by such tests reads as unproven. The workaround is a vitest file under `tests/` that runs the Python tests and names each criterion in its titles.

What would fix it: count `test_*.py`, `*_test.py` and files under any `tests/` folder as test files, and read `def test_*` names and the first docstring line of each Python test as titles.

Where: `src/pipeline/change-evidence.ts` (`isTestFile`) and `src/traceability/change-map.ts` (`extractTitlesAndTags`, `TEST_CALL`).
