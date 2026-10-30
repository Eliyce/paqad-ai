---
id: "TD-01M6607402K2CM9P7JVSSJWSSY"
title: "End-of-turn completion check judges the change while expert and chief seats still run; the running-agent hold covers only stage agents"
kind: "bug"
severity: "medium"
status: "open"
files: []
found_in:
  change: "01M65SFN9BMVXRVPPYN44SJEVQ"
  issue: "754"
  stage: "review"
found_by: "paqad-review"
session: "b56f5d5d-6913-44b6-a7b8-a4346eb0fd48"
created_at: "2026-10-30T08:53:26.129Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

On the green-run reuse change (session b56f5d5d-6913-44b6-a7b8-a4346eb0fd48), the end-of-turn completion check ran while High Table expert seats (paqad-expert / chief seats) and stage agents were still running in the background. It judged the change anyway: the review gate and the acceptance-criteria test mapping. The running-agent hold that should defer the completion verdict while dispatched agents are still running only covers stage agents. It does not cover paqad-expert or chief seats, so the gate reported findings on a change that was still being worked on.

## Fix

Make the running-agent hold cover every dispatched paqad agent type, including expert and chief seats, not only stage agents. While any of them is running, the end-of-turn check should defer its verdict (or read Inconclusive "agents still running"), not judge the change.
