---
id: "TD-01M6G05D9RNEEW8HPG7ZY3J07E"
title: "Released paqad 1.116.0 does not stop on the migrated stub's minimum_version, so INV-6/AC-73 are not met and AC-63 has no pinned-release proof"
kind: "gap"
severity: "high"
status: "open"
files:
  - "src/core/team-config-migrate.ts"
  - "tests/unit/core/team-config-migrate.test.ts"
found_in:
  change: "01M6EX814WG84WBN1YCW034G48"
  issue: "791"
  stage: "checks"
found_by: "paqad-review"
session: "6e440033-f345-4ab7-baee-663c65ece92f"
created_at: "2026-11-03T06:04:54.432Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The stub that `update` writes over `.paqad/configs/.config.app` (FR-45) relies on the last released paqad (1.116.0) refusing to run because of `minimum_version`. It does not. In 1.116.0 `minimum_version` is read only by `runtime/hooks/silent-update.mjs`: with `auto_update` on it starts a detached `npm install -g paqad-ai@latest` in the background (the current session keeps running on the old version, with the stub giving it only defaults), and with `auto_update` off or `skip_version_check` on it only appends a WARN line to `.paqad/logs/auto-update.log` (`noteUnmetFloorWhileDisabled`). Nothing stops the session or asks to update.

So FR-46, INV-6 and AC-73 ("stopped and asked to update, never run on defaults") are not met for at least the first session, and never for a teammate with auto_update off. AC-63 is proven only by parsing the stub with today's `parseDotConfig` (tests/unit/core/team-config-migrate.test.ts:335), not by running a pinned older paqad.

Options for the owner: accept the one-session window and update the spec and README wording; add `paqad_enable=false` to the stub so an older paqad turns itself off instead of running on defaults (1.116.0 reads `paqad_enable` from `.config.app`; the new readers ignore the stub, but check the shell reader, which reads every `.config.*` file without the stub check); or add a real integration test that installs the pinned release and records what it does.
