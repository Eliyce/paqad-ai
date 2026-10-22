---
id: "TD-01M5JE09CZQAYQZ9ZMFVAG046T"
title: "Every coding prompt is guessed onto the fast lane because the prompt seam classifies without the project profile"
kind: "bug"
severity: "high"
status: "open"
files:
  - "src/pipeline/classifier.ts"
  - "src/pipeline/prompt-lane.ts"
  - "src/pipeline/router.ts"
found_in:
  change: "01M5JAC57SYAJ69SV5MZN8A40K"
  issue: "726"
  stage: "checks"
found_by: "orchestrator"
session: "72b15d9e-cb70-4983-bb58-af0f55e62c69"
created_at: "2026-10-22T18:29:33.715Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What happens

Every coding prompt is guessed onto the fast lane before the ticket is read.

`resolvePromptRoute` in `src/pipeline/prompt-lane.ts` calls the classifier with only `{ request }`, never the project profile. With no profile, `inferCapabilityGap` in `src/pipeline/classifier.ts` assumes only the `content` capability is active, so any coding request reads as a capability gap. `PipelineRouter.route` in `src/pipeline/router.ts` then sends every capability-gap request that is not high complexity or high risk to `fast`.

## Proof

Probed with the real classifier and router:

| Prompt | Without profile | With profile |
| --- | --- | --- |
| issue with "Verify each claim, small commits, one branch" | bug-fix, gap, fast | bug-fix, no gap, graduated |
| implement issue N | feature-development, gap, fast | graduated |
| add a logout button | gap, fast | graduated |
| fix the typo in the header | gap, fast | graduated |

## Why it is not fixed here

Passing the profile flips nearly every coding prompt to graduated, which turns on stage isolation, the spec pipeline and the High Table by default. That is a product decision about default depth, not part of the HUD fix.
