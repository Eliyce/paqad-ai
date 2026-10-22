---
id: "TD-01M5H0JKDRHQE25RE3K96DXHW3"
title: "Dashboard serveStatic sends the directory's size as content-length when it serves a directory index.html without gzip"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/dashboard/server.ts"
found_in:
  change: "01M5FTB2H17C1WTKHNGVTZVZQJ"
  issue: "713"
  stage: null
found_by: "review"
session: "e99f1b6e-48f6-45a4-a6f4-6cfac09ea07f"
created_at: "2026-10-22T05:15:39.311Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`serveStatic` in `src/dashboard/server.ts` stats the requested path, and when it is a directory it swaps `filePath` to `<dir>/index.html` but keeps the directory's `st`. On the non-gzip branch (client does not accept gzip, or a non-text MIME type) it sends `content-length: String(st.size)`, which is the directory entry size, not the size of index.html. The response is then truncated or the client waits for bytes that never come. Fix: re-stat after switching to index.html. Found while reviewing the dashboard coverage tests; not touched by this change.
