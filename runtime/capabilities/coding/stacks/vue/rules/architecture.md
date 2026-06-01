# Vue Architecture

- Module ownership and boundaries are defined per-project in `docs/instructions/rules/module-map.yml`; treat that file as the source of truth for which feature owns which directory, and do not invent a parallel folder taxonomy.
- Author components with `<script setup>` and the Composition API; keep business logic in composables (`useX`) and Pinia stores, and keep page/route components focused on composition and layout.
- Extract reusable stateful logic into composables rather than mixins; do not reintroduce Options-API mixins into a Composition-API codebase.
- Define one canonical module per concern — the API/HTTP client, the router config, and shared UI primitives — and import from it rather than re-instantiating clients or re-declaring route paths per feature.
- Import across features only through each feature's public entry module; do not deep-import another feature's internal components or stores.
- In SSR codebases (Nuxt), keep code that touches `window`/`document` or server-only secrets out of the universal render path; gate browser-only logic to client execution.
