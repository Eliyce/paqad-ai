---
'paqad-ai': patch
---

Cross-platform output consistency: normalize path strings to forward slashes at more production output boundaries — DocumentationWorkflow generated/skipped arrays and handover_path, onboarding orchestrator manifest writes and return values, `saveObligationIndex` return, registry-generator source_paths (both native-module and signal-extracted), and the project-question phase write target. Fix `slugifySpec` to split on both `/` and `\\` so spec-indexed compliance paths derive correctly on Windows. Rewrite `sanitizePersistedPath` to avoid relying on `process.cwd()` for relative inputs. Drops the Windows CI failure count from 15 → 11 test files (#41).
