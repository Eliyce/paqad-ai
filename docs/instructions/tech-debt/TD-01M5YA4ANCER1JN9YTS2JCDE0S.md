---
id: "TD-01M5YA4ANCER1JN9YTS2JCDE0S"
title: "The ChatGPT directory zip is not attached to the GitHub Release"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - ".github/workflows/release.yml"
  - "plugins/discovery/build/package_chatgpt.py"
found_in:
  change: "01M5XRN9CWF9RDTNFC1A21A0SV"
  issue: null
  stage: "checks"
found_by: "development"
session: "fc6c87cb-2eca-4348-a38c-19dc8d58585c"
created_at: "2026-10-27T09:12:44.958Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The ChatGPT directory submission zip (built by plugins/discovery/build/package_chatgpt.py) is not attached to the GitHub Release. The release is created by scripts/release-sync.mjs in release.yml, and adding a Python step there would make the release need Python, which this change avoids.

For now the zip is built by hand from a checkout: python3 plugins/discovery/build/build.py --dist dist, then python3 plugins/discovery/build/package_chatgpt.py --dist dist. A follow-up can attach it, for example from a separate job that runs after the release.
