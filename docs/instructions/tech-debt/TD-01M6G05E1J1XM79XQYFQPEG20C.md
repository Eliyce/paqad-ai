---
id: "TD-01M6G05E1J1XM79XQYFQPEG20C"
title: "Release PR must set LEGACY_TEAM_CONFIG_READ_UNTIL to release date + 90 days in all five copies"
kind: "follow-up"
severity: "medium"
status: "open"
files:
  - "runtime/hooks/lib/paqad-disabled.sh"
  - "src/core/framework-config.ts"
found_in:
  change: "01M6EX814WG84WBN1YCW034G48"
  issue: "791"
  stage: "checks"
found_by: "paqad-review"
session: "6e440033-f345-4ab7-baee-663c65ece92f"
created_at: "2026-11-03T06:04:55.196Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`LEGACY_TEAM_CONFIG_READ_UNTIL` is set to the placeholder `2027-02-01`. Request §6.4 says the release PR sets it to the release date plus 90 days. It exists in five places that must change together: src/core/framework-config.ts:41, runtime/claude-plugin/mod/config.ts:110, runtime/hooks/lib/paqad-disabled.mjs:419, runtime/templates/team-bootstrap/hook.mjs:53 and runtime/hooks/lib/paqad-disabled.sh:38 (`-le 20270201`). tests/unit/core/team-config-window.test.ts ("every copy of the date matches") fails if they drift. The tests use INSIDE=2026-12-01 and AFTER=2027-03-01, so a new date outside that range needs those constants moved too.
