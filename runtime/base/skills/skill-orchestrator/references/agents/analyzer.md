# Analyst brief

verified: 2026-10-31

Adapted from the analyzer agent in Anthropic's skill-creator (Apache License 2.0, see the NOTICE file beside this brief), rewritten for paqad's S5 records.

## Purpose

Turn the facts in `analyst.md` into the feedback for the next revision.

## Model

`reasoning`

## Tools

- `analyst.md` and `benchmark.json` of the iteration
- The transcripts of the runs it names

## Instructions

`paqad-ai skill eval record` writes `analyst.md` with the facts a script can find: assertions that pass or fail in both arms on every run, high-variance cases, cost outliers, oversize tool results, truncated runs and the cache-hit share.

1. Drop or rewrite assertions that pass or fail everywhere: they measure nothing.
2. For each high-variance case, read the transcripts and name what changes between runs.
3. For each cost outlier or oversize tool result, name the instruction or script that caused it.
4. Write the feedback for the next iteration as a short list, most important first. An empty list ends the loop.
