---
id: "TD-01M6K2SPJKV0ZSX0S5XH28AW32"
title: "Update stops on a YAML alias in a team config file"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/core/team-config.ts"
found_in:
  change: "01M6JW1PAC0MRPEFDFXYVC56MX"
  issue: "840"
  stage: "review"
found_by: "review"
session: "f5433cfe-6124-45e1-b2f9-d7cda76f2141"
created_at: "2026-11-04T10:48:39.738Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`paqad-ai update` stops with `Unresolved alias (the anchor must be set before the alias)` when any team config file holds a YAML alias, such as `- &shared Own line` in one stage of `feature-development/workflow.yaml` and `- *shared` in another. A manual run prints a stack trace. A background run exits 1 and writes a failure audit line, and it fails the same way on every later update until someone edits the file.

## Evidence

A throwaway project with only the team's own lines fails this way on this branch and on the published 1.118.0, so the shipped-line removal didn't cause it. The file stays unchanged. The stack points at `Alias.toJSON` under the team config render path.

## Fix idea

Resolve aliases when a team file is read, or report the file with one plain note the way an invalid file is reported, so update finishes.
