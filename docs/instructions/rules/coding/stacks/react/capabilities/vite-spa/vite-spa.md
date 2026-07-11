# React Vite SPA

Loads for a Vite single-page app. See `environment.md` for env-var handling; this file covers the SPA build itself.

- Bootstrap the app in one entry (`main.tsx`): mount with `createRoot` and wrap the tree in routers and providers there, not scattered across components. <!-- @rule RL-0041 -->
- Treat the bundle as public. A Vite SPA ships no server, so keep every secret and privileged call behind a separate backend or API. MUST NOT embed an API key in the bundle. <!-- @rule RL-270f -->
- Code-split routes and heavy dependencies with dynamic `import()` + `React.lazy`/`<Suspense>` so the initial chunk stays small; rely on Vite/Rollup automatic chunking and reach for `manualChunks` only for a measured win. <!-- @rule RL-62fc -->
- Reference static assets via `import` or the `public/` directory so Vite fingerprints and rewrites their URLs. MUST NOT hard-code a `/src/...` path that breaks in the production build. <!-- @rule RL-d38b -->
- Configure path aliases once in `vite.config.ts` and mirror them in `tsconfig` `paths`; do not maintain a divergent alias set. <!-- @rule RL-3221 -->
- Verify a change against the production build (`vite build` + `vite preview`), not only the dev server, when you touch plugins, aliases, or asset handling. Dev and prod resolve modules differently. <!-- @rule RL-80d8 -->
