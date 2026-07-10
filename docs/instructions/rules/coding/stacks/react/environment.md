# React Environment

- Read environment values through one typed config module that validates them at startup (e.g. with `zod`), not scattered `import.meta.env`/`process.env` reads across components. <!-- @rule RL-a854 -->
- Only expose variables intended for the browser: under Vite they must be prefixed `VITE_`; under Next.js they must be prefixed `NEXT_PUBLIC_`. Never reference an unprefixed secret in client code — it will not be defined and risks leaking if mis-prefixed. <!-- @rule RL-5ca2 -->
- Keep server-only secrets (API keys, DB URLs) out of any module that can be imported by a client component or the browser bundle. <!-- @rule RL-077f -->
- Fail fast at boot when a required variable is missing, with an error naming the variable, rather than letting `undefined` propagate into requests. <!-- @rule RL-207a -->
- Do not commit `.env*` files containing real secrets; commit a `.env.example` listing the required keys with placeholder values. <!-- @rule RL-d5f6 -->
