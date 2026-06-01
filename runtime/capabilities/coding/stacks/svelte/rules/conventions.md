# Svelte Conventions

- Declare reactive component state with the `$state` rune and computed values with `$derived` (or `$derived.by` for blocks); do not use the legacy `let`-as-reactive or `$:` reactive statements in Svelte 5 components.
- Declare component inputs with `let { foo, bar = default } = $props()`; do not use `export let` in new components.
- Use `$effect` only to sync with non-reactive systems (DOM, third-party libs, subscriptions) and return a cleanup function; never set `$state`/`$derived` values inside an effect to avoid feedback loops.
- Bind list items with keyed `{#each items as item (item.id)}` so updates are stable.
- Load page/layout data in `load` functions: put server-only data access (DB, secrets, private fetch) in `+page.server.ts`/`+layout.server.ts`, and use `+page.ts` only for universal data; return data and read it via the typed `data` prop / `$props`.
- Handle mutations with SvelteKit form actions in `+page.server.ts` (`export const actions`) and progressively enhance forms with `use:enhance`; do not post to ad-hoc endpoints for standard form submits.
- Keep secrets and server config in `$env/static/private` or `$env/dynamic/private`; expose values to the client only through `$env/static/public` (`PUBLIC_`-prefixed).
- Read route params, URL, and parent data from the `load` event (`params`, `url`, `await parent()`) rather than reaching into globals.
- Throw `error(status, message)` and `redirect(status, location)` from `@sveltejs/kit` for HTTP errors and redirects in load/actions, not manual `Response` construction.
- Define standalone API routes as `+server.ts` exporting `GET`/`POST`/etc. returning a `Response` or `json(...)`; validate request input before use.
- Share cross-component state with runes in a `.svelte.js`/`.svelte.ts` module (exporting functions or getters), not by mutating module-level `let` that loses reactivity, and avoid shared mutable state on the server where requests are concurrent.
