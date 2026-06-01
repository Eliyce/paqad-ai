# Vue Environment

- Read environment values through one typed config module that validates them at startup (e.g. with `zod`), not scattered `import.meta.env` reads across components.
- Only expose browser-safe variables: under Vite/Vue CLI they must be prefixed `VITE_` and are read via `import.meta.env.VITE_*`; under Nuxt, expose them through `runtimeConfig.public` and keep private keys in the top-level `runtimeConfig`.
- Keep server-only secrets (API keys, DB URLs) out of any module bundled to the browser; in Nuxt keep them in server-only `runtimeConfig`/`server/` code.
- Fail fast at boot when a required variable is missing, with an error naming the variable, rather than letting `undefined` reach requests.
- Do not commit `.env*` files with real secrets; commit a `.env.example` listing required keys with placeholder values.
