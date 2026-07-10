# React Security

Loads when you write React UI that handles data, links, or auth. Sharpens `_shared/security.md` with React specifics; it does not repeat the baseline.

- Render user text as children so React escapes it. MUST NOT pass unsanitized HTML to `dangerouslySetInnerHTML`; when HTML is unavoidable, sanitize it with `DOMPurify` first.
- Validate the scheme before you build an `href` or `src` from user input, and reject `javascript:` and `data:` URLs.
- Treat client-side route guards as UX only, and enforce every mutation's authorization on the server or API. The client is untrusted.
- Keep secrets and privileged calls server-side (server components, route handlers, or a backend); anything in client code or a browser-exposed env var is public.
- Store auth tokens in `HttpOnly`, `Secure`, `SameSite` cookies, not `localStorage`, which any injected script can read.
- Add `rel="noopener noreferrer"` to every `target="_blank"` link to an external origin, to prevent reverse-tabnabbing.
- Parse data crossing a trust boundary (API responses, URL params, `postMessage`) with a schema validator before use. MUST NOT assume the shape.

## Verify

```bash
# dangerouslySetInnerHTML — confirm a sanitizer wraps each hit:
git grep -n 'dangerouslySetInnerHTML' -- '*.tsx' '*.jsx'
# target="_blank" missing rel=noopener:
git grep -n 'target="_blank"' -- '*.tsx' '*.jsx' | grep -v noopener
# Auth tokens in localStorage:
git grep -nE 'localStorage\.(set|get)Item\([^)]*(token|jwt|auth)' -- '*.ts' '*.tsx'
```
