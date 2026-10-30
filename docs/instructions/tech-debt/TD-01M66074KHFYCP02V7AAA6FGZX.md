---
id: "TD-01M66074KHFYCP02V7AAA6FGZX"
title: "Green-run reuse key ignores git-ignored inputs, non-node runtime versions, env and git-normalised content"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/checks/build-output.ts"
  - "src/checks/run-checks.ts"
  - "src/checks/run-history.ts"
found_in:
  change: "01M65SFN9BMVXRVPPYN44SJEVQ"
  issue: "754"
  stage: "review"
found_by: "paqad-review"
session: "b56f5d5d-6913-44b6-a7b8-a4346eb0fd48"
created_at: "2026-10-30T08:53:26.751Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The green-run reuse key is: the tree digest (tracked and untracked files that are not git-ignored), the exact command string, the lockfile hash, the Node version of the paqad process and, with a build, the fingerprint of the pack's build_outputs. A real run can still differ from the reused green when only inputs outside that key changed:
- git-ignored files that tests read: `.env`, `.env.testing`, `.env.local`, generated clients (prisma, openapi, graphql codegen), and local config overrides. Only `dist` is guarded, and only for the react and node-service packs. A react project that builds to `build/` or `.next/` never reuses build (safe), but a stale `dist/` next to it can satisfy the fingerprint.
- runtime versions other than Node: PHP, Python, Ruby or Java switched with phpenv, pyenv, rbenv or sdkman. Non-node stacks reuse test with no build fingerprint, and their runtime version is not in the key.
- environment variables (CI, NODE_ENV, DATABASE_URL, APP_ENV) and external state (a database schema migrated outside the tree).
- content git normalises away: eol conversion with text=auto, and clean filters such as nbstripout. An edit that only changes line endings or filtered content keeps the same digest.

The spec accepted node_modules drift. It did not weigh these. Under the owner constraint ("do not lower the quality bar of onboarded project"), a dotenv change in a Laravel or Next project that a real run would fail on is reported green.

## Fix

Add a pack-declared `reuse_inputs` list (for example `.env*` and generated folders) that is hashed into the reuse key the same way as build_outputs. Add the stack runtime version (`php -v`, `python --version`) to the key for non-node packs. Name the remaining limits in check-runner.md.
