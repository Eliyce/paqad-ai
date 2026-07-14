---
'paqad-ai': minor
---

New routed workflow #10 **codebase-health** (backed by **health-retest**): a project health check-up on demand, at the same tier as pentest and design-test. Say "check my project's health" and paqad scans for six kinds of junk — dead code, unused packages, outdated or risky packages, leaked secrets, stale docs, and copy-paste AI slop — and lands every finding in one report with proof (real tool output, never an AI opinion), a plain-words reason it matters, and what to do about it.

Detection is a single deterministic verb, `paqad-ai health run`, that costs zero model tokens: it reuses the code-knowledge index (dead code, unused deps), the 9-ecosystem dependency inventory, OSV/native-audit vulnerability data, registry deprecation metadata, and the chunk-similarity index, shelling out to `osv-scanner`, `gitleaks`, `jscpd`, and `knip` when they are on PATH and degrading gracefully (labelled fallbacks or `blocked_checks`) when they are not. Findings carry stable content-addressed `HL-` ids, split honestly into a "Proven" section (deterministic) and a "Needs judgment" section (ai-judged, confidence-scored), and never expose secret bytes — only a file:line + rule + fingerprint.

A baseline ratchet marks findings `new-since-baseline` vs `pre-existing` so a legacy project isn't drowned, `--offline` skips the network categories, and `paqad-ai health retest` re-runs the evidence and reclassifies each finding `fixed | still-open | needs-manual-verification` by its stable id. The workflow is classifier-routed (health phrasings route to codebase-health; pentest phrasings still route to pentest), surfaces in the dashboard, and its run summaries flow to the SIEM export.
