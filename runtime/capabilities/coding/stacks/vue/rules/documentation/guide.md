# Vue Documentation

- When a change adds, removes, or renames a route, update the route table in the owning module's docs under `docs/modules/<module>/` so the documented route list matches the router config (or Nuxt `pages/`).
- Document non-obvious component contracts (required `provide`/`inject` keys, required props, emitted events, exposed methods) in a comment or the module doc, not only in the type declarations.
- Keep `README`/setup docs accurate for the commands they name (dev, build, test); update them when scripts in `package.json` change.
- Prefer linking to the canonical module doc over duplicating the same explanation across multiple components.
