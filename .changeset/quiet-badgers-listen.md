---
'paqad-ai': patch
---

fix(#540): stop a background notification opening a change and orphaning a bundle

A `<task-notification>` from a background monitor reaches a session as an ordinary user
turn, and the extra `Stop` it produces made the marker parser re-read the whole transcript.
With the previous change already closed, nothing was active, so every stale `paqad:stage`
line read as unrecorded and a phantom untitled `change-<ULID>` bundle was opened for it —
stealing the session pointer and failing its own completion gate, which turned a finished,
green change into a red one.

Three seams are fixed:

- The prompt-routing seam recognises a host-injected system notification and treats it as
  no request at all, so a CI ping cannot re-route or clobber an in-flight change.
- The retrospective marker seam refuses to open a bundle once the session has already
  closed a change. A session's first change is unaffected, including on the Codex and
  Gemini completion hooks that share the seam.
- `paqad-ai resume --feature <ref>` now resolves a ref against the recorded bundles on
  disk as well as the session's paused stack, so a displaced change is reachable without
  hand-editing anything under `.paqad/ledger/`.
