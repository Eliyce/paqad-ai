---
id: "TD-01M6607570YQYTDDTS5HRVJCNE"
title: "Changed-files format argv can exceed the cmd.exe line limit on Windows"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/checks/format-changed.ts"
found_in:
  change: "01M65SFN9BMVXRVPPYN44SJEVQ"
  issue: "754"
  stage: "review"
found_by: "paqad-review"
session: "b56f5d5d-6913-44b6-a7b8-a4346eb0fd48"
created_at: "2026-10-30T08:53:27.373Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The changed-files format passes up to 200 `./`-prefixed paths as argv to `pnpm exec prettier` or `npx`. On Windows those are `.cmd` shims, which run through cmd.exe, and cmd.exe has an 8191-character command-line limit. 200 deep paths can pass it, so the format command fails with "The command line is too long" and checks go red. This is a false red, not a false green. check-runner.md says that above 200 files the full command "cannot hit an argv length limit", which suggests the 200 cap is enough.

## Fix

Cap the list by total argv length (for example about 6000 characters on win32) as well as by count, and fall back to the full format command above the cap.
