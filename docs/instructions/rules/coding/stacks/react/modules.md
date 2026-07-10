# React Module Boundaries

- Module ownership and boundaries are defined per-project in `docs/instructions/rules/module-map.yml`. Treat it as the source of truth for which feature owns which paths; do not introduce a new top-level feature folder without a corresponding entry there. <!-- @rule RL-bef4 -->
- Import another feature only through its declared public entry module; do not deep-import its internal components, hooks, or stores. <!-- @rule RL-274e -->
- Keep shared cross-feature code (UI primitives, the API client, utilities) in the shared/common module the map designates, not duplicated inside individual features. <!-- @rule RL-b6ed -->
