# Architecture

- Module ownership and boundaries are defined per-project in `docs/instructions/rules/module-map.yml`. Consult it before adding code, and keep each change inside the owning module. <!-- @rule RL-08a6 -->
- Extend an existing module before creating a new one; add a new module only when no existing boundary fits. <!-- @rule RL-42c0 -->
- Expose cross-module dependencies through public interfaces; do not reach into another module's internals. <!-- @rule RL-0b99 -->
- Record significant architectural decisions in `docs/`. <!-- @rule RL-9b9a -->
