# Laravel Module Boundaries

- Keep domain ownership aligned with `docs/modules/<module>/` and avoid scattering one feature across unrelated areas.
- Reuse existing module/service boundaries before introducing new folders or abstractions.
- Treat cross-module access as an explicit contract; do not reach into another module's private internals casually.
- Keep route, API, integration, and error docs updated in the owning module docs when behavior changes.
- Record module-level assumptions, dependencies, and side effects in the affected module documentation.
