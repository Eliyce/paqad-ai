---
id: "TD-01M5YA48T7EM2P3KHFM12T8XFD"
title: "Python 3.9 is past end of life but still pinned in the discovery-plugin CI job"
kind: "debt"
severity: "low"
status: "open"
files:
  - ".github/workflows/ci.yml"
  - "scripts/build-discovery.mjs"
found_in:
  change: "01M5XRN9CWF9RDTNFC1A21A0SV"
  issue: null
  stage: "checks"
found_by: "development"
session: "fc6c87cb-2eca-4348-a38c-19dc8d58585c"
created_at: "2026-10-27T09:12:43.065Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The discovery-plugin CI job pins Python 3.9 because 3.9 is the oldest Python the discovery build and its scripts support. Python 3.9 reached end of life in October 2025, so actions/setup-python may stop offering it on a future ubuntu runner, and the job would then fail for reasons unrelated to the change under test.

When that happens, or earlier by choice, raise the floor: pick the oldest supported Python, change the setup-python version in the discovery-plugin job, the minimum in scripts/build-discovery.mjs (MIN_PYTHON) and its one-line message, and the "Python 3.9+" notes in plugins/discovery.
