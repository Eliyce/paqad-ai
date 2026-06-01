# Laravel Documentation

- Document a changed or new API endpoint with its route name, HTTP method, path, request payload (the Form Request rules), response shape (the API Resource fields), and the status codes it can return.
- When you add or change a validation rule, reflect the new constraint (required fields, formats, limits) in the endpoint's documented request contract.
- When you add or change a queued Job, Event, or Notification, document what dispatches it, what it does, and whether it is idempotent/retry-safe.
- When you add or rename a config key or required `.env` variable, document it (key name, purpose, default) so deployments set it.
- Document the props contract (names, types, required/optional) for each Inertia/Blade page a change touches, in that module's UI doc.
- Do not paste generated artisan output or full file dumps into docs; describe the behavior and reference the route/class names so docs stay reviewable against a diff.
