# React Documentation

- When a change adds, removes, or renames a route, update the route table in the owning module's docs under `docs/modules/<module>/` so the documented route list matches the router config.
- Document non-obvious component contracts (required providers/context, required props, side effects) in a comment or the module doc, not just in the prop types.
- Keep `README`/setup docs accurate for the commands they name (dev server, build, test); update them when scripts in `package.json` change.
- Prefer linking to the canonical module doc over duplicating the same explanation across multiple component files.
