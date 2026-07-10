# React Localization

Loads when you render user-facing copy, dates, or numbers.

- Render user-facing copy through the project's i18n library (`react-i18next`, `react-intl`, `next-intl`) via translation keys. MUST NOT hard-code a display string in JSX.
- Build plurals and interpolated values with the i18n API's plural and format features, not string concatenation, so grammar stays correct per locale.
- Format dates, numbers, and currency with `Intl.DateTimeFormat`/`Intl.NumberFormat` (or the i18n library's formatter) bound to the active locale, not by hand.
- Assert on translation keys or test ids in tests, not translated literals, so a copy edit does not break a test.
- Keep enum-to-label and status-to-copy mapping in one module keyed by translation key, instead of re-deriving labels per component.
