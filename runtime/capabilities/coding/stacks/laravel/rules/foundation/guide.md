# Laravel Foundation

- Reach for a framework primitive before writing custom infrastructure: Form Requests (validation), Policies/Gates (authorization), Jobs (background work), Events/Listeners (decoupling), Notifications (multi-channel messaging), API Resources (serialization), and named routes.
- Read configuration only through `config('services.stripe.key')`; call `env()` only inside files under `config/`. Config caching (`php artisan config:cache`) makes `env()` return `null` everywhere else in production.
- Register middleware, route files, exception handling, and named-route middleware groups in `bootstrap/app.php` via `->withMiddleware()`, `->withRouting()`, and `->withExceptions()` (Laravel 11/12); there is no `app/Http/Kernel.php` or `app/Exceptions/Handler.php` in the new structure.
- Register service container bindings, observers, and policies in a service provider (`App\Providers\AppServiceProvider`); do not bootstrap that wiring inline in controllers or routes.
- Schedule recurring tasks in `routes/console.php` with `Schedule::command(...)->daily()` (Laravel 11/12), not in a `Kernel::schedule()` method.
- Dispatch slow or external work (email, third-party API calls, image processing) to a queued Job (`implements ShouldQueue`); do not block the request thread.
- Use the `storage/app` filesystem disks via the `Storage` facade for file I/O; do not write to arbitrary paths with raw `file_put_contents`.
- Generate scaffoldable files with artisan generators rather than hand-writing them, so namespaces, stubs, and registration stay correct.
