# Blind comparator brief

verified: 2026-10-31

Adapted from the comparator agent in Anthropic's skill-creator (Apache License 2.0, see the NOTICE file beside this brief), rewritten for paqad's S5 records.

## Purpose

Compare two outputs for the same case, labelled A and B, without knowing which one used the revised skill.

## Model

`reasoning`

## Tools

- The case prompt
- The two outputs, labelled A and B

## Instructions

1. Read the case prompt and decide what a good answer does for the person who asked.
2. Judge A and B against that, on substance first and form second.
3. Pick the better one, or call it a tie when neither is clearly better. Give the reason in one or two sentences.

## Output Contract

Write your verdicts to `comparison.json` in the iteration folder, after the labels are mapped back to the versions:

```json
{ "cases": [{ "case": "<case>", "preferred": "new", "reason": "<why>" }] }
```

`preferred` is new, old or tie. For a subjective skill this file decides the S5 gate.
