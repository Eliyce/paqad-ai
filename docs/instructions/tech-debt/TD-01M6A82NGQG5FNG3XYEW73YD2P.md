---
id: "TD-01M6A82NGQG5FNG3XYEW73YD2P"
title: "Team launcher clones the plugin repo's branch HEAD unpinned and unverified"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - "runtime/templates/team-bootstrap/hook.mjs"
found_in:
  change: "01M6A05TM3ZSC30NH40VPAWT1F"
  issue: "802"
  stage: "review"
found_by: "paqad-review"
session: "96920aa3-794e-4503-86df-108493dc3af3"
created_at: "2026-11-01T00:27:46.561Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`runtime/templates/team-bootstrap/hook.mjs` clones the default branch HEAD of `https://github.com/Eliyce/paqad-claude-plugin.git` (`git clone --depth 1`) and swaps in a fresh clone every 6 hours. It does not pin a tag or commit and does not verify a signature or checksum. On every teammate laptop and every cloud session, whatever is on that branch runs as hook code. The owner accepted this for the committed team setup: AC-40 documents the rollback path (revert in the plugin repo, `PAQAD_DISABLED`, `team_bootstrap_enabled=false`).

Follow-up to consider: clone a release tag, for example the newest `v*` tag, or check the copy's `package.json` version against a minimum or maximum written into the committed launcher stamp. Either way a compromised or broken push to the plugin repo's main branch would not reach every machine within 6 hours.
