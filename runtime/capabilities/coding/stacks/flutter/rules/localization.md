# Flutter Localization

- Do not hard-code user-facing strings in screens, widgets, states, or errors.
- Add new translation keys for every supported locale in the same change.
- Keep enum-to-label mapping centralized so widgets do not duplicate translation logic.
- Prefer assertions on keys, state, or semantics instead of translated literals in tests.
- If localization implementation changes, follow `docs/tools/flutter/easy-localization.md` when that package is in scope.
