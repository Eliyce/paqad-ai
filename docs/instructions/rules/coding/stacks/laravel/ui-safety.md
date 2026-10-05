# Laravel UI Safety

- Render an explicit branch for each state of a data-driven view: loading, empty (no records), success, and error. Do not assume a collection is non-empty before iterating it. <!-- @rule RL-f204 -->
- Disable submit controls and show a pending indicator while a request is in flight (Inertia `useForm`'s `processing`, or a disabled-button guard) so a form cannot be double-submitted. <!-- @rule RL-e062 -->
- Gate destructive actions (delete, cancel, payout) behind an explicit confirmation step before the request fires; do not delete on a single unconfirmed click. <!-- @rule RL-6eb4 -->
- Display server-side validation errors next to the field that failed, using the errors Laravel returns (`$errors` in Blade, `form.errors` in Inertia); do not silently swallow a `422`. <!-- @rule RL-8eb9 -->
- Show authorization failures honestly: a user lacking permission sees a `403`/forbidden state, not a blank screen or a success message. <!-- @rule RL-4687 -->
- Preserve working back/cancel navigation and keep route protection (`auth`, `verified`, policy middleware) intact when changing flows; a UI change must not expose a previously protected route. <!-- @rule RL-998a -->
- Surface flash messages (`session()->flash(...)` / Inertia shared flash) for the outcome of an action instead of leaving the user without feedback. <!-- @rule RL-7f8b -->
- Document the props and the states each page renders in that module's UI doc when behavior changes. <!-- @rule RL-1924 -->
