# React Vite SPA

- Keep app bootstrapping in one entry (`main.tsx`): mount with `createRoot`, and wrap the tree in routers/providers there rather than scattering provider setup across components.
- Expose browser env vars only via the `VITE_` prefix and read them through `import.meta.env` in one typed config module; unprefixed vars are not bundled and must never hold secrets.
- A Vite SPA ships no server — keep all secrets and privileged calls behind a separate backend/API; never embed API keys in the bundle.
- Code-split routes and heavy dependencies with dynamic `import()` + `React.lazy`/`<Suspense>` so the initial chunk stays small; rely on Vite/Rollup automatic chunking and only configure `manualChunks` for measured wins.
- Reference static assets via `import` or the `public/` directory so Vite fingerprints and rewrites their URLs; do not hard-code `/src/...` paths that break in the production build.
- Configure path aliases once in `vite.config.ts` and mirror them in `tsconfig` `paths`; do not maintain divergent alias sets.
- Verify changes against the production build (`vite build` + `vite preview`), not just the dev server, when touching plugins, aliases, or asset handling — dev and prod resolve modules differently.
