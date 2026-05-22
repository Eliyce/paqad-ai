# Vue Architecture

- Keep feature ownership aligned with `docs/modules/<module>/` and avoid scattering one flow across unrelated folders.
- Pages or routes coordinate composition; business logic belongs in composables, services, and state layers.
- Do not mix transport parsing, schema validation, rendering, and side effects in one file when the behavior is non-trivial.
- Centralize route builders, API clients, and shared UI primitives instead of duplicating them per feature.
- Reflect changed route, component, and state behavior in the matching canonical docs.
