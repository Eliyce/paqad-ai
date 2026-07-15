---
'paqad-ai': minor
---

feat(#389): imperative advisory-host stage protocol + honest JetBrains tiering

The JetBrains Claude Agent incident (framework followed, but stages unenforced and
the ledger empty of planning/specification artifacts) exposed that on advisory hosts
paqad had zero enforcement and relied on the model voluntarily self-recording. The
bootstrap only said "narrate every stage and the verdict yourself" — too weak. The
advisory-host section now imperatively requires running the host-independent CLI for
a feature-development change: `paqad-ai stage start/end`, `paqad-ai plan compile`, and
`paqad-ai spec freeze`, in order, so the stage-evidence ledger carries real planning +
specification artifacts even where no lifecycle hook fires.

The verification-enforcement doc now documents the three JetBrains products honestly:
**Claude Agent / AI Assistant** reads `CLAUDE.md`-equivalent guidance but fires no
Claude Code hooks (advisory — the incident's host), the **Claude Code [Beta] plugin**
runs the real `claude` CLI so paqad's hooks fire (full, hook-enforced — the supported
enforcement path), and **Junie** is advisory. The `aiassistant` adapter (already
correctly `hooks:false`) is now listed in the per-adapter coverage matrix, and a
reproducible manual advisory-host protocol is documented. No host-detection change and
no overclaim of enforcement paqad does not have on the host.
