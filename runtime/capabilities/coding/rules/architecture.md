# Architecture

- Module ownership and boundaries are defined per-project in `docs/instructions/rules/module-map.yml`. Consult it before adding code, and keep each change inside the owning module.
- Extend an existing module before creating a new one; add a new module only when no existing boundary fits.
- Expose cross-module dependencies through public interfaces; do not reach into another module's internals.
- Record significant architectural decisions in `docs/`.
