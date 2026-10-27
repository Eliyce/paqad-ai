---
id: "TD-01M5YAWJ4XG3MM5K4S3HWR1X9D"
title: "Generated module summary footer is duplicated across 37 docs/modules pages and trips the duplication detector"
kind: "debt"
severity: "low"
status: "open"
files:
  - "docs/modules/adapter-onboarding/index/summary.md"
found_in:
  change: "01M5XRN9CWF9RDTNFC1A21A0SV"
  issue: null
  stage: "review"
found_by: "review"
session: "fc6c87cb-2eca-4348-a38c-19dc8d58585c"
created_at: "2026-10-27T09:25:59.052Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The duplication detector flagged docs/modules/adapter-onboarding/index/summary.md lines 341-358 (the Authority, How to Update These Docs and Related sections). The same generated boilerplate sits in 37 module summary pages under docs/modules. This change does not touch that file; it was last changed on main by 6ca6ab70. Either teach the duplication detector to skip the generated module-doc footer, or move the footer into one shared page the summaries link to.
