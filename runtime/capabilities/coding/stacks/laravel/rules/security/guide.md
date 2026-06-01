# Laravel Security

- Declare `$fillable` (allow-list) or `$guarded` on every model and never pass `$request->all()` into `create()`/`update()`/`fill()`; use `$request->validated()` so only whitelisted, validated keys are mass-assigned.
- Authorize every state-changing action with a Policy or Gate (`$this->authorize('update', $post)`, `Gate::authorize(...)`, or `can:` middleware). Do not assume an authenticated user is authorized for a specific record.
- Scope queries to the current user/tenant (`$request->user()->posts()->findOrFail($id)`); do not trust an ID from the request to belong to the caller (prevents IDOR).
- Keep the CSRF `@csrf` token in every Blade `<form>`; do not add routes to the `validateCsrfTokens` except exclusion list unless they are stateless API endpoints behind token auth.
- Validate all input with Form Requests / the validator, including `exists:`, `unique:`, `enum:`, and `max:` rules; never reach into `$request->input()` for unvalidated values in write paths.
- Generate temporary public links with signed URLs (`URL::signedRoute()` / `temporarySignedRoute()`) and verify with the `signed` middleware or `$request->hasValidSignature()`; do not pass raw IDs in unauthenticated links.
- Hash passwords with the `Hash` facade or the `'hashed'` cast; never store or compare plaintext. Compare secrets/tokens with `hash_equals`, not `==`.
- Escape output by default: use `{{ $value }}` in Blade (auto-escaped) and reserve `{!! !!}` for content you have explicitly sanitized; never echo raw user input as HTML.
- Keep secrets in `.env` and reference via `config()`; never commit `.env`, hardcode API keys, or log credentials, tokens, or full request payloads.
- Use Eloquent/query-builder bindings for all SQL; if `DB::raw`/`whereRaw` is unavoidable, pass user values as bindings, never interpolate them into the string.
- Rate-limit authentication, password-reset, and other abuse-prone routes with the `throttle:` middleware.
