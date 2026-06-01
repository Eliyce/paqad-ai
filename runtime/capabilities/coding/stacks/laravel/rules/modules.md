# Laravel Module Boundaries

- Module ownership and cross-module boundaries are defined per project in `docs/instructions/rules/module-map.yml`. Treat that file as the source of truth for which directories/classes a module owns and which modules may depend on it. Do not restate or duplicate those boundaries here.
- Before adding a new top-level folder or abstraction, check `module-map.yml` for an existing owner and place the code there.
- Within Laravel's own structure, keep code in its conventional directory: HTTP entry points in `app/Http/Controllers`, validation in `app/Http/Requests`, authorization in `app/Policies`, domain models in `app/Models`, background work in `app/Jobs`, and serialization in `app/Http/Resources`.
- Keep route files (`routes/web.php`, `routes/api.php`, `routes/console.php`) thin: declarations pointing at controller/command classes, no business logic.
- When a change crosses a boundary defined in `module-map.yml`, go through the owning module's public interface (a service, action, or event) rather than querying another module's models directly.
