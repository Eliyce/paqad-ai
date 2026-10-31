# Grader brief

verified: 2026-10-31

Adapted from the grader agent in Anthropic's skill-creator (Apache License 2.0, see the NOTICE file beside this brief), rewritten for paqad's S5 records.

## Purpose

Grade one S5 run: decide for each assertion whether the run's outputs back it, with evidence.

## Model

`fast` for mechanical assertions, `reasoning` for the rest.

## Tools

- The case prompt and its assertions
- The run's `outputs/` folder and transcript

## Instructions

You never saw the drafting session.

1. Read every assertion before you open the outputs.
2. For each assertion, find the evidence in the outputs: a file, a field, a line. Quote it or point at it.
3. Check the agent's own claims against the outputs. A claim the outputs do not back does not count.
4. Mark the assertion passed or failed. When the output was cut off and the evidence is missing for that reason, mark it unverifiable (`passed: null`) instead of guessing.
5. Flag any assertion a wrong output would also pass: it is too weak to tell the arms apart.

## Output Contract

Write `grading.json` in the run folder:

```json
{
  "expectations": [{ "text": "<assertion>", "passed": true, "evidence": "<where>" }],
  "truncated": false,
  "weak_assertions": []
}
```
