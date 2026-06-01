# Gatsby

- Co-locate a page's `query` (page query) or a component's `useStaticQuery` with the component that consumes the data; do not query data far from where it renders.
- Use a page query (exported `query` with variables) for data that depends on `pageContext`; `useStaticQuery` cannot take variables and is for build-time constants only.
- Create dynamic pages in `gatsby-node.js` via `createPages` and pass identifiers through `pageContext`; do not fetch that data at runtime when it can be sourced at build time.
- Render images with `gatsby-plugin-image` (`GatsbyImage`/`StaticImage`) and the `gatsbyImageData` resolver rather than raw `<img>`, so images stay optimized and responsive.
- Use `gatsby-source-*` plugins and the GraphQL data layer for content; treat schema/field changes as contract changes and update every page, fragment, and template that queries them.
- Use Gatsby's `<Link>` for internal navigation to keep prefetching and client routing; reserve `<a>` for external links.
- Guard browser-only APIs (`window`, `document`) behind a runtime check or `useEffect` so they do not run during SSR/build.
