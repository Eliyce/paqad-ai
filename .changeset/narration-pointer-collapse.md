---
'paqad-ai': patch
---

Collapse the in-chat narration contract in provider entry files to a one-line pointer (#173). The full voice spec stays in the canonical `.paqad/narration-contract.md`; the entry files (CLAUDE.md, AGENTS.md, and every adapter) now carry only the heading plus a pointer line, matching the Decision Pause Contract shape. `paqad refresh --providers` rewrites already-onboarded projects down to the pointer.
