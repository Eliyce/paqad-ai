---
id: "TD-01M66PP4B448XAX7T93CP7KCD5"
title: "Version-only PR skip never runs tests that read CHANGELOG.md, .changeset or the package version"
kind: "gap"
severity: "low"
status: "open"
files:
  - "scripts/release-sync.mjs"
  - "tests/unit/plugin/plugin-skills.test.ts"
found_in:
  change: "01M66GC8XZANSCVFJ9K074G5MF"
  issue: "757"
  stage: "documentation_sync"
found_by: "review"
session: "8478d9b0-11b9-4af1-ae6f-c8c98311ab70"
created_at: "2026-10-30T15:26:06.671Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The version pull request shortcut (scripts/release-sync.mjs versionOnlyDiff and scopeDecision) skips the test matrix when a PR changes only the `version` field of package.json, CHANGELOG.md, and deletes `.changeset/*.md` files on a proven green base. The main push of that PR then skips again, and `prepublish` skips `pnpm run ci`, so the published tree's CHANGELOG.md and `.changeset/` contents are never run through the suite.

Some tests do read those inputs: tests/unit/plugin/plugin-skills.test.ts:106-110 reads `.changeset/one-paqad-plugin-discovery-skills.md` if it exists, else CHANGELOG.md, and asserts skill names are present; `__PKG_VERSION__` (vitest.config.ts define) feeds tests such as tests/unit/core/framework-config.test.ts:1006. Today these still pass on a version bump, so the risk is low, but nothing guards against a future test whose outcome depends on the changelog, the changesets or the exact version.

Possible follow-ups: a ci-workflow test that greps the suite for reads of CHANGELOG.md / .changeset / package.json version and fails unless they are on an allow list; or run only those files on a version PR.
