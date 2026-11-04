---
id: "TD-01M6K1JWM70BNV30N1TTWVTQG2"
title: "The migrated stub says an older paqad asks to update, but 1.116.0 only turns itself off"
kind: "bug"
severity: "low"
status: "closed"
files:
  - ".paqad/configs/.config.app"
  - "src/core/team-config-migrate.ts"
found_in:
  change: "01M6JW1PAC0MRPEFDFXYVC56MX"
  issue: "840"
  stage: null
found_by: "development"
session: "f5433cfe-6124-45e1-b2f9-d7cda76f2141"
created_at: "2026-11-04T10:27:27.978Z"
reopened_at: null
issue: null
closed_reason: "The stub now says an older paqad turns itself off, and writes the heading only with leftovers. A stub already on disk keeps the old text."
---

## What

`stubText` in `src/core/team-config-migrate.ts` writes this comment into every migrated `.paqad/configs/.config.app`: "it turns itself off instead of running on its defaults, and asks to update."

The second half is wrong for 1.116.0. Run against a stub with `paqad_enable=false` and `minimum_version=1.117.0`, a 1.116.0 install turns itself off and never asks to update:

- `silent-update.mjs` returns on the off switch before it reads the minimum version, so no update starts and no npm call runs.
- `plugin-session-start.mjs`, `agent-entry-session-start.mjs` and `agent-entry-prompt-gate.mjs` exit 0 and print nothing.
- `paqad-ai doctor` says paqad is disabled and suggests `paqad-ai enable`, which isn't an update.

With the off switch set to true, the same 1.116.0 starts a `forced-minimum` update to the newest version, so the minimum version works only while paqad is on.

The owner ruled that this repo's stub keeps the off switch, its `minimum_version` is 1.117.0, and the check that a 1.116.0 install asks to update is not met. The comment was left as it is. The wording needs correcting in `stubText` and in the existing stubs it wrote. Compare what older releases do before choosing new wording.
