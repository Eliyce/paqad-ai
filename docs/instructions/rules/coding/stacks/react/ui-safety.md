# React UI Safety

Loads when you build data-driven or interactive React views. Sharpens `_shared/design-system.md` and the accessibility rules with React specifics.

- Render an explicit loading, empty, success, and error state for every async or data-driven view. MUST NOT leave a blank screen while a request is pending or after it fails.
- Wrap render-time failures in an error boundary (a class with `getDerivedStateFromError`/`componentDidCatch`, or the router's `errorElement`) so one broken subtree does not blank the app, and catch effect and handler errors explicitly.
- Disable the submit control while a mutation is in flight and re-enable it on success or error, so a double-click cannot double-submit.
- Confirm a destructive or irreversible action with the user before you run it.
- Use a real `<button>` or `<a>` for clicks and navigation (not a click-handled `<div>`), associate a label with every input, and keep a visible focus state.
- Keep a working back path after a route change and re-apply route guards. MUST NOT strand the user on a protected or 404 route with no way out.
