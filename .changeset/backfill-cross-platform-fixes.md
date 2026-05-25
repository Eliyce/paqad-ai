---
'paqad-ai': patch
---

Normalize generated path strings to forward slashes at more production output boundaries for cross-platform consistency (#30, #33). Retry `runScript` once on transient bash-subprocess failures (#25). Skip Windows-incompatible tests in CI excludes and align timeouts (#28).
