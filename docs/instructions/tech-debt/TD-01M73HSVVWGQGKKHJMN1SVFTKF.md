---
id: "TD-01M73HSVVWGQGKKHJMN1SVFTKF"
title: "Research plan can queue a package name that another manifest entry marks private"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/rules-discovery/research.ts"
found_in:
  change: "01M73AE41TYA4MJPNJZS30HMPE"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "47d0b214-1a99-540a-9748-0d7cf867e1a3"
created_at: "2026-11-10T20:18:44.646Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

src/rules-discovery/research.ts planResearch skips a private entry and then still queues a later public entry with the same ecosystem:name key (a package declared as file:/git: in one manifest and as a registry range in another, with no workspace manifest naming it). The name then appears both in skipped_private and in the research order, and the research validator rejects its ideas as researching a private package. Treat a key as private when any of its entries is private.
