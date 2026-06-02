---
'paqad-ai': patch
---

fix(#72): make `refresh` opt-in and stop shipping generic design-token defaults

- `paqad-ai refresh` with no target flag is now a status-only no-op. Stack refresh and module-map reconciliation are no longer implicitly on — every target (`--stack`, `--context`, `--providers`, `--rules`, `--reconcile-module-map`) must be requested explicitly, so `refresh` never materializes files the user did not ask for.
- The design-token seed no longer writes a generic teal/amber brand. It seeds a clearly-marked, neutral placeholder scaffold, and the documentation workflow refuses to derive `design-system/*.md` and theme exports from that placeholder (skipping with a clear "fill in your real tokens" message) instead of generating authoritative-looking docs for a design system that does not exist.
