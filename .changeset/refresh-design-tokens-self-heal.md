---
'paqad-ai': patch
---

`paqad-ai refresh` now self-heals when `docs/instructions/architecture/design-tokens.json` is missing (#56). The design-system step seeds default tokens via the existing idempotent `DesignTokenService.seed()` before generating docs and theme exports, so `--stack` and `--context` sub-refreshes no longer get aborted by an unhandled `ENOENT`. `DesignTokenService.load()` now translates a missing file into a typed `DesignTokensMissingError` with an actionable message; invalid (but present) files still surface the existing validation error.
