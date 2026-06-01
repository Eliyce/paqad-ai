# Vue Localization

- Render user-facing copy through the project's i18n library (typically `vue-i18n`, or `@nuxtjs/i18n` in Nuxt) via translation keys; do not hard-code display strings in templates.
- Build plurals and interpolated values with the i18n API's pluralization/interpolation features, not string concatenation, so grammar stays correct per locale.
- Format dates, numbers, and currency with `Intl.DateTimeFormat`/`Intl.NumberFormat` (or vue-i18n's `$d`/`$n`) bound to the active locale, not manual formatting.
- In tests, assert on translation keys or test ids rather than translated literals so copy edits do not break tests.
- Centralize enum-to-label and status-to-copy mapping in one module keyed by translation key, instead of re-deriving labels per component.
