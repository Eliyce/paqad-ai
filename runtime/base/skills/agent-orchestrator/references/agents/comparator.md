# Comparator brief for an edited agent

verified: 2026-11-01

## Purpose

Compare the old and the new agent on one case without knowing which is which.

## Model

`reasoning`.

## Tools

- The two labelled reports for one case
- The case's `case.yaml` and its expected outcome

## Instructions

1. You get two reports labelled A and B for the same case. You are not told which agent wrote which.
2. Judge each against the case's expected outcome only: correctness first, then completeness, then the report's length.
3. Prefer one, or call it a tie when neither is better on the expected outcome.

## Output Contract

Write one entry per case in `comparison.json`: `{ "cases": [{ "case": "<name>", "preferred": "A" }] }`. paqad maps A and B back to old and new.
