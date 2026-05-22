# React Vite SPA

- Keep client-side route ownership, bootstrapping, and app providers explicit in the main entry path.
- Centralize environment access, API client setup, and build-time configuration instead of scattering `import.meta.env` usage.
- Watch bundle growth, code-splitting, and lazy-route behavior when adding new screens or heavy dependencies.
- Prefer typed route, state, and API boundaries over implicit prop drilling across the SPA shell.
- Validate production build assumptions when changing Vite plugins, aliases, or asset handling.
