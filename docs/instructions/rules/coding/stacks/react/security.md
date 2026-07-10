# React Security

- Do not pass unsanitized or user-controlled HTML to `dangerouslySetInnerHTML`; if you must render HTML, sanitize it first with `DOMPurify`. Prefer rendering text as children (React escapes it).
- Never build `href`/`src` from user input without validating the scheme — reject `javascript:` and `data:` URLs to prevent script execution on click.
- Treat the client as untrusted: enforce authentication and authorization on the server/API for every mutation; client-side route guards are UX only, not a security boundary.
- Keep secrets and privileged API calls server-side (server components, route handlers, or a backend); anything in client code or a browser-exposed env var is public.
- Store auth tokens in `HttpOnly`, `Secure`, `SameSite` cookies rather than `localStorage`, which is readable by any injected script.
- Add `rel="noopener noreferrer"` to any `target="_blank"` link to external origins to prevent reverse-tabnabbing.
- Validate and type all data crossing a trust boundary (API responses, URL params, `postMessage`) with a schema validator before use; do not assume response shapes.
