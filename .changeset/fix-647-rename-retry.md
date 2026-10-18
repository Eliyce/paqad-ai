---
'paqad-ai': patch
---

Atomic file writes no longer fail now and then on Windows (#647). When another writer holds the target for a moment, Windows refuses the final rename with `EPERM`, `EACCES` or `EBUSY`. paqad now retries that rename up to five times (waits of 10, 20, 40 and 80 ms) and removes its temp file if it still gives up. macOS and Linux behave as before.
