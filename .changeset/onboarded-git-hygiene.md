---
'paqad-ai': minor
---

Make onboarded repos' git hygiene self-contained and correct. paqad now manages its ignore policy inside `.paqad/` (a nested `.paqad/.gitignore` + `.paqad/.gitattributes`) instead of editing the project's root `.gitignore`; re-onboarding scrubs the old paqad-managed block out of the root file. Three policy fixes ship with the move: the boot pointer `framework-path.txt` now stays committed so a teammate can clone and boot without re-onboarding; the per-machine `framework-version.txt` is now git-ignored so silent self-updates no longer churn the tree (the silent-update hook recreates it locally on first session); and `.paqad/ledger/` is now ignored unconditionally so enabling the enterprise ledger can never leak evidence into git. The health check resolves "is this ignored?" via git (honoring the nested file) and no longer treats the local version file as a required committed artifact.
