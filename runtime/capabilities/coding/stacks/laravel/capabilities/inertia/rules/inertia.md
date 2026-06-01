# Inertia.js with Laravel

- Return page components from controllers with `Inertia::render('Posts/Index', [...])`; do not return JSON API responses from a route the frontend visits as an Inertia page.
- Pass only the props a page needs, transformed through an API Resource or array; do not hand a full Eloquent model to `Inertia::render`, which serializes every attribute including hidden ones.
- Defer non-critical data so it loads after first paint: use `Inertia::optional(fn () => ...)` for props fetched only on partial reloads, and `Inertia::defer(fn () => ...)` (Inertia v2) for data shown after the initial render. `Inertia::lazy()` is deprecated — use `optional` instead.
- Put globally shared values (auth user, flash messages, CSRF/ziggy data) in `HandleInertiaRequests::share()`; do not re-pass them from every controller.
- Validate write requests with Form Requests; on failure Inertia returns the errors as `$page.props.errors`, surfaced through `useForm().errors` — do not build a parallel client validation contract.
- Submit and navigate with `useForm()` or `router.visit/post/put/delete`; do not use `fetch`/`axios` for page transitions, which bypasses Inertia's history and prop handling.
- Use `useForm()`'s `processing` flag to disable submit controls while a request is pending, and its `reset()`/`onSuccess` callbacks for post-submit state.
- Keep page components under `resources/js/Pages/` with a directory layout that mirrors the route groups.
- Document each page's props contract (names, types, required/optional) in the owning module's UI doc.
