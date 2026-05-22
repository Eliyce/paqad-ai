# Vue Localization

- Do not hard-code user-facing strings in pages, components, composables, or stores.
- Keep translation keys stable across route-level and component-level rendering.
- Prefer assertions on keys, state, or semantics instead of translated literals in tests.
- Centralize enum-to-label and status-to-copy mapping instead of duplicating it per component.
- If localization setup changes, update testing and UI docs in the same change.
