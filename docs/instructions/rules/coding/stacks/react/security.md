# React Security

- Do not pass unsanitized or user-controlled HTML to `dangerouslySetInnerHTML`; if you must render HTML, sanitize it first with `DOMPurify`. Prefer rendering text as children (React escapes it). <!-- @rule RL-8fc9 -->
- Never build `href`/`src` from user input without validating the scheme — reject `javascript:` and `data:` URLs to prevent script execution on click. <!-- @rule RL-ef16 -->
- Treat the client as untrusted: enforce authentication and authorization on the server/API for every mutation; client-side route guards are UX only, not a security boundary. <!-- @rule RL-8d95 -->
- Keep secrets and privileged API calls server-side (server components, route handlers, or a backend); anything in client code or a browser-exposed env var is public. <!-- @rule RL-5ab2 -->
- Store auth tokens in `HttpOnly`, `Secure`, `SameSite` cookies rather than `localStorage`, which is readable by any injected script. <!-- @rule RL-0743 -->
- Add `rel="noopener noreferrer"` to any `target="_blank"` link to external origins to prevent reverse-tabnabbing. <!-- @rule RL-faf7 -->
- Validate and type all data crossing a trust boundary (API responses, URL params, `postMessage`) with a schema validator before use; do not assume response shapes. <!-- @rule RL-c31e -->
