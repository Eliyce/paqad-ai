# Inertia.js with Laravel

- Use `Inertia::render()` in controllers to return page components; avoid mixing JSON API responses with Inertia responses on the same route.
- Pass only the data a page needs via Inertia props; avoid sending entire Eloquent models directly.
- Use lazy props (`Inertia::lazy`) for data that is not required on initial load.
- Use shared data (`HandleInertiaRequests` middleware) for globally available values such as auth user and flash messages.
- Preserve scroll position and use Inertia's `preserveState` option when navigating within the same page component.
- Use `router.visit`, `router.post`, `router.put`, and `router.delete` for client-side navigation; do not use native `fetch` for page transitions.
- Keep Inertia page components in `resources/js/Pages/` and align the directory structure with Laravel route groups.
- Validate all incoming requests with Form Requests before returning an Inertia response.
- Use Inertia's `useForm` helper for form state management and server-side validation error display.
- Document the props contract for each Inertia page component in the corresponding module UI doc.
