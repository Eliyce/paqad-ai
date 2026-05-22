# Laravel Localization

- Do not hard-code user-facing copy in controllers, requests, notifications, or views.
- Keep translation keys consistent between backend responses and frontend rendering.
- When enums or statuses are shown to users, expose translated labels or stable i18n keys.
- Add tests against keys, states, or behavior rather than brittle translated strings.
- If localization setup changes, follow `docs/tools/laravel/testing.md` and update impacted docs.
