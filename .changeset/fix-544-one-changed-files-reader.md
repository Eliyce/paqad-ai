---
'paqad-ai': patch
---

One reader for `.paqad/session/changed-files.json` (#544).

- `paqad-ai review digest` could be headed by files from an earlier, already-merged change, because it trusted the session cache as-is. It now reads changed files through the same git reconcile the completion checks use: cached files that are clean and already in base history are dropped, and with nothing left it lists the branch's real working-tree changes.
- Module-health session evidence and the differential refresh in `paqad-ai refresh` no longer act on those stale entries either. With no cache they behave exactly as before.
- Traceability read the cache as a `{ files }` object that nothing writes, so it never saw a single changed file. It now reads the bare array like every other reader.
- The file has exactly one reader in the codebase now, so a shape change can never again break one consumer silently.
