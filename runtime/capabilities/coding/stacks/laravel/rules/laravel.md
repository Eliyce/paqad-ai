# Laravel Runtime

- Prefer framework primitives before custom infrastructure: Form Requests, policies, jobs, notifications, events, resources, and named routes.
- Generate scaffoldable files with project-approved commands from `docs/tools/laravel/artisan.md`.
- If the project uses Sail, run PHP, Composer, Artisan, and Node commands through `docs/tools/laravel/sail.md`.
- Keep `env()` calls inside config files only; use `config()` elsewhere.
- Add factories for new models and keep queued work idempotent and retry-safe.
