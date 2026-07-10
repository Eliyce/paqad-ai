# React Localization

- Render user-facing copy through the project's i18n library (`react-i18next`, `react-intl`, `next-intl`, etc.) via translation keys; do not hard-code display strings in JSX. <!-- @rule RL-dc8a -->
- Build plurals and interpolated values with the i18n API's plural/format features, not string concatenation, so grammar stays correct per locale. <!-- @rule RL-88a1 -->
- Format dates, numbers, and currency with `Intl.DateTimeFormat`/`Intl.NumberFormat` (or the i18n library's formatter) bound to the active locale, not manual formatting. <!-- @rule RL-66d9 -->
- In tests, assert on translation keys or test ids rather than translated literals so copy edits do not break tests. <!-- @rule RL-9466 -->
- Centralize enum-to-label and status-to-copy mapping in one module keyed by translation key, instead of re-deriving labels per component. <!-- @rule RL-635e -->
