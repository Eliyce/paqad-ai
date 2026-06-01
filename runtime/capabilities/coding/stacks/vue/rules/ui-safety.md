# Vue UI Safety

- Every async/data-driven view must render explicit loading, empty, success, and error states; never leave a blank screen while a request is pending or after it fails.
- Catch render/child errors with `onErrorCaptured` (or your router/Nuxt error boundary, e.g. `<NuxtErrorBoundary>`) so one broken subtree does not blank the whole app; handle errors in async handlers explicitly.
- Disable submit buttons and guard against duplicate submission while a mutation is in flight; re-enable on success or error.
- Require explicit confirmation for destructive or irreversible actions before performing them.
- Keep interactive elements accessible: real `<button>`/`<a>` for clicks/navigation (not `@click` on a `<div>`), labels associated with inputs, and visible focus states.
- Preserve valid navigation: after a route change keep a working back path and re-apply route guards; do not strand the user on a protected or 404 route with no way out.
