---
'paqad-ai': minor
---

Per-feature evidence report (issue #371): a feature's whole on-disk record — plan, frozen spec, every stage with real durations, the rules that ran, what retrieval found, the verification receipt, the AI-BOM, the commit trail, and the review — is now rendered into one self-contained, human-readable `report.html` by a pure script (no LLM, no network), saved next to the JSON it came from and byte-for-byte identical on every provider. A normal person can read it, it prints cleanly to PDF for an auditor, it stays local and git-ignored, and it makes zero external requests.

Every section communicates gracefully when its data is absent: a missing plan, an unrun retrieval, or (on a non-enterprise install) an absent verification receipt and AI-BOM each render an explicit plain-English note instead of a blank gap. The verification receipt honestly says whether its hash-chain integrity recomputes, and a failed gate is shown as plainly and prominently as a passing one.

New: `paqad-ai feature report [ref] [--out <file>] [--open] [--quiet]`. The report is regenerated automatically at end-of-change (covering Claude Code, Codex, and Gemini through the one verification backstop) and after every commit/merge (covering advisory hosts through the git hooks), always best-effort so it can never disrupt the feature-development stages or the verification verdict. Two config flags: `feature_report` (default on) and `feature_report_auto_open` (default off; sandbox-aware, skips CI/SSH/remote/headless).
