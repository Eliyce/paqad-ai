# React Environment

Loads when you read or add environment variables. Sharpens `_shared/security.md`.

- Read env values through one typed config module that validates them at startup (for example with `zod`), not scattered `import.meta.env`/`process.env` reads across components. <!-- @rule RL-f3c7 -->
- Expose only browser-intended variables, and only via the framework's public prefix: `VITE_` under Vite, `NEXT_PUBLIC_` under Next.js. MUST NOT reference an unprefixed secret in client code. <!-- @rule RL-7632 -->
- Keep server-only secrets (API keys, DB URLs) out of any module a client component or the browser bundle can import. <!-- @rule RL-2ba0 -->
- Fail fast at boot when a required variable is missing, with an error that names it, rather than letting `undefined` reach a request. <!-- @rule RL-8206 -->
- MUST NOT commit a real `.env*` secret; commit a `.env.example` listing the required keys with placeholder values. <!-- @rule RL-72e6 -->

## Verify

```bash
# Only .env.example should be tracked — any other committed .env is a finding:
git ls-files | grep -E '(^|/)\.env(\.|$)' | grep -v '\.env\.example'
# Raw import.meta.env reads outside the config module (review each hit):
git grep -n 'import\.meta\.env' -- '*.tsx' '*.ts' | grep -vi config
```
