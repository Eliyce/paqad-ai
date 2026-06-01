# Quasar

- Use Quasar components (`q-*`) and the layout system (`QLayout`/`QPage`/`QPageContainer`) for structure instead of re-implementing equivalents; do not wrap them in thin pass-through components without a real reuse gain.
- Run app-startup logic (plugin registration, interceptors, i18n/router setup, auth bootstrap) in boot files registered under `boot` in `quasar.config`, not ad hoc in `main`/components.
- Trigger Notify, Dialog, Loading, and similar Quasar plugins through their composables/`useQuasar()` (`$q`), and enable each plugin in `quasar.config` `framework.plugins` before use.
- Read responsive and platform state from `$q.screen` and `$q.platform` rather than hand-rolled `window.matchMedia`/user-agent checks.
- Keep build-mode-specific code (SPA/SSR/PWA/Capacitor/Electron) behind Quasar's mode flags/conditionals; do not assume `window` exists in SSR mode.
- Keep business logic in composables and Pinia stores, not inside `q-page` components.
- Customize theme via Quasar's Sass/CSS variables and `quasar.config`, not by overriding component internals with brittle selectors.
