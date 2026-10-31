---
id: "TD-01M69MP747DP27WB5NYZ4MTVMV"
title: "Improve-mode S5 default regression tolerance 0.2 lets a 20-point pass-rate drop pass as no regression"
kind: "follow-up"
severity: "medium"
status: "open"
files:
  - "src/authoring/eval/aggregate.ts"
  - "src/core/framework-config.ts"
found_in:
  change: "01M6968HSVNBV1X20K3ANPE472"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "ec34a7d7-3ffc-45bc-bcad-4e805868ea1d"
created_at: "2026-10-31T18:48:55.667Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The improve-mode S5 gate (D-01M69KJ77857JK6711KW9Z4CKV) reads authoring_regression_tolerance as an absolute drop in pass-rate points: floor = -tolerance * 100 (src/authoring/eval/aggregate.ts judgeS5Gate). That reading is consistent with the key being a 0..1 share and delta_points being percentage points. The default of 0.2 (src/core/framework-config.ts) lets an edit drop from 95% to 76% and still pass as "no regression"; S8 shares the same key. Tightening the default (for example 0.05) or adding a relative floor is a policy choice for the owner, not part of this change.
