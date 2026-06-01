# Astro Conventions

- Keep components static by default; add a client directive (`client:load`, `client:idle`, `client:visible`, or `client:only`) only on the islands that need interactivity, and prefer `client:visible`/`client:idle` over `client:load` to defer hydration.
- Define content collections in `src/content.config.ts` with `defineCollection`, a `loader` (`glob()` or `file()`), and a Zod `schema`; query them with `getCollection()`/`getEntry()` rather than reading files by hand. The pre-v5 `src/content/config.ts` + folder-based collections layout is legacy.
- Validate frontmatter through the collection's Zod schema and use `reference()` for relations between collections; do not access untyped frontmatter from `import`ed Markdown.
- Set the rendering strategy explicitly: keep `output: 'static'` (the default) for prerendered pages, and switch to `output: 'server'` with an adapter only when you need SSR; use `export const prerender = true/false` to opt individual routes in or out.
- Put server endpoints in `src/pages/**/*.ts` exporting `GET`, `POST`, etc., returning a `Response`; do not put mutating logic in `.astro` page frontmatter.
- Access secrets and server config via `astro:env` (`getSecret`, server schema) or `import.meta.env`; only `PUBLIC_`-prefixed variables are exposed to client-side code.
- Fetch data in the component frontmatter (the code fence) for static/SSR pages; remember frontmatter runs at build time for static output, so do not rely on it for per-request data unless the route is server-rendered.
- Use `Astro.props` for typed component inputs and pass data down rather than re-fetching in child components; scope styles with the default scoped `<style>` block.
- Keep heavy UI-framework components out of the hydration path unless interactive — render React/Vue/Svelte islands server-side and hydrate selectively.
- Configure integrations (`@astrojs/react`, sitemap, MDX, adapters) in `astro.config.mjs`; do not hand-wire framework renderers.
