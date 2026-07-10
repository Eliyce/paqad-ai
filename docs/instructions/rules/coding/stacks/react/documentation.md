# React Documentation

Loads when a React change touches routes, component contracts, or setup commands. Sharpens `_shared/documentation.md`.

- When a change adds, removes, or renames a route, update the route table in the owning module's docs under `docs/modules/<module>/` so it matches the router config.
- Document a non-obvious component contract (required providers or context, required props, side effects) in a comment or the module doc, not only in the prop types.
- Keep the `README` and setup docs accurate for the commands they name (dev, build, test), and update them when a `package.json` script changes.
- Link to the canonical module doc rather than repeating the same explanation across component files.
