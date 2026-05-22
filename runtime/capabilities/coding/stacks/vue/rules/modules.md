# Vue Module Boundaries

- Keep route, feature, and shared UI ownership aligned with the canonical module docs.
- Reuse existing module and package boundaries before introducing new folders or abstractions.
- Treat cross-module imports as explicit contracts; avoid reaching into another feature's private internals.
- Keep route, UI, integration, and error docs updated in the owning module when behavior changes.
- Record module-level assumptions, dependencies, and side effects in the affected docs.
