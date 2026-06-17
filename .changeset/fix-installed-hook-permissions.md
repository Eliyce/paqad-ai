---
'paqad-ai': patch
---

Restore the executable bit on the installed runtime hooks and scripts.

The package is published with `changeset publish`, which packs the tarball with pnpm. pnpm normalises every file mode to `0644` and drops the executable bit (npm preserves it), so on an installed copy the host agent could not run any runtime hook: invoking `~/.paqad-ai/current/hooks/verification-completion.mjs` failed with "permission denied". The visible symptom was that the verification backstop never fired for onboarded projects, so the evidence ledger, receipts, AI-BOM, and the local dashboard data were never produced. A `postinstall` step now re-adds the executable bit on every install and update, with no action required from the user.
