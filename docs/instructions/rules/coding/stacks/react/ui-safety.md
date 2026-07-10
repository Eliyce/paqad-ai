# React UI Safety

- Every async/data-driven view must render explicit loading, empty, success, and error states; never leave a blank screen while a request is pending or after it fails. <!-- @rule RL-4560 -->
- Wrap render-time failures in an error boundary (a class component with `getDerivedStateFromError`/`componentDidCatch`, or your router's `errorElement`) so one broken subtree does not blank the whole app; effect/handler errors must be caught explicitly. <!-- @rule RL-3205 -->
- Disable submit buttons and guard against duplicate submission while a mutation is in flight; re-enable on success or error. <!-- @rule RL-23fd -->
- Require explicit confirmation for destructive or irreversible actions before performing them. <!-- @rule RL-7cb6 -->
- Keep interactive elements accessible: real `<button>`/`<a>` for clicks/navigation (not click-handled `<div>`s), labels associated with inputs, and visible focus states. <!-- @rule RL-8dcf -->
- Preserve valid navigation: after a route change keep a working back path and re-apply route guards; do not strand the user on a protected or 404 route with no way out. <!-- @rule RL-5188 -->
