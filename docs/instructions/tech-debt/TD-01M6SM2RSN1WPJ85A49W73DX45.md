---
id: "TD-01M6SM2RSN1WPJ85A49W73DX45"
title: "A ticket ask after 'not really,' or 'not yet,' still reads as negated"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/pipeline/pre-classifier.ts"
found_in:
  change: "01M6SCTKHRJ3BVTHQY2T3XR3KV"
  issue: "831"
  stage: "review"
found_by: "paqad-review"
session: "950169d2-6a83-4705-9685-3a9e2bc76ca4"
created_at: "2026-11-06T23:46:09.299Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

A ticket ask after a filler word and a comma still reads as negated. Measured through runPromptRouteSeam: `not really, open a ticket for the flaky test` and `not yet, open a ticket for the flaky test` route no-workflow, not project-question. Punctuation is gone by the time `isNegatedAt` in src/pipeline/pre-classifier.ts looks back, so these read the same as the AC-9 row `we do not really open a ticket`, which must stay negated.

## Why it is low

The person loses a route guess, not work: `paqad-ai route set` recovers it. `never mind, ...` and `not urgent, ...` are fixed. Words outside the filler list now count as an ask (`do not then create a ticket` routes project-question), but a message that also asks for code keeps its feature route (measured).

## Fix path

Stop the look back at a comma, sentence or line boundary read from the raw text before normalizing, and add the prompts above as tests beside AC-9.
