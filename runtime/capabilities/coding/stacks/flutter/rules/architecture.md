# Flutter Architecture

- Keep feature logic inside its owning module and keep shared code generic.
- Screens coordinate composition and lifecycle; business logic belongs in state/controllers, services, and repositories.
- Do not mix transport parsing, domain mapping, and widget rendering in the same file.
- Centralize route builders, API clients, and shared UI primitives instead of duplicating them per feature.
- Reflect changed screen/state/integration behavior in the matching `docs/modules/<module>/` documentation.
