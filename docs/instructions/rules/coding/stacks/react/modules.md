# React Module Boundaries

Loads when you import across feature folders. See `architecture.md` for the `module-map.yml` source-of-truth and canonical-module rules; this file covers the import boundary itself.

- Import another feature only through its declared public entry module. MUST NOT deep-import its internal component, hook, or store.
- Keep shared cross-feature code (UI primitives, the API client, utilities) in the shared module the map designates, not copied into individual features.
- Add a new top-level feature folder only with a matching entry in `docs/instructions/rules/module-map.yml`.
