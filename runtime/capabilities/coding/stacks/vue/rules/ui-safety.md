# Vue UI Safety

- Every user-facing flow must handle loading, empty, success, and failure states explicitly.
- Destructive actions require visible confirmation and must prevent duplicate submits while pending.
- Route changes must preserve valid back paths, guards, and error boundaries.
- Validate browser-visible auth and route behavior with `docs/tools/vue/playwright.md` when appropriate.
- Keep module UI docs in sync with changed screen, state, and error behavior.
