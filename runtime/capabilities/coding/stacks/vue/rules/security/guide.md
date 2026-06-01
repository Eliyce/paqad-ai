# Vue Security

- Do not bind user-controlled content with `v-html`; Vue escapes `{{ }}` and `:`-bound text automatically, so render text normally. If HTML is truly required, sanitize it with `DOMPurify` first.
- Never bind `:href`/`:src` from user input without validating the scheme — reject `javascript:` and `data:` URLs.
- Avoid dynamic component/template patterns driven by user input (`v-bind` to a user-chosen `is`, runtime template compilation); they can execute injected expressions.
- Treat the client as untrusted: enforce authentication and authorization on the server/API for every mutation; Vue Router navigation guards are UX only, not a security boundary.
- Keep secrets and privileged calls server-side (a backend, or Nuxt server routes / private `runtimeConfig`); anything in client code or a `VITE_`/`public` env var is public.
- Store auth tokens in `HttpOnly`, `Secure`, `SameSite` cookies rather than `localStorage`, which any injected script can read.
- Add `rel="noopener noreferrer"` to external `target="_blank"` links, and validate/parse all data crossing a trust boundary (API responses, route params) with a schema before use.
