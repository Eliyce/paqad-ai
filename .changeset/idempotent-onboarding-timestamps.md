---
'paqad-ai': patch
---

Make onboarding re-runs idempotent (#27): when `.paqad/detection-report.json`, `.paqad/onboarding-manifest.json`, and `.paqad/framework-version.txt` would otherwise be byte-identical apart from their embedded timestamp, the writer now reuses the existing timestamp instead of stamping a fresh one. A no-op re-run produces zero diff; any real change still bumps the timestamp. Fixes the Windows-CI `is idempotent across repeated onboarding runs` failure (timing luck was hiding the same bug on macOS/Linux).
