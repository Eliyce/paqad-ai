# Laravel Foundation

- Reach for a framework primitive before writing custom infrastructure: Form Requests (validation), Policies/Gates (authorization), Jobs (background work), Events/Listeners (decoupling), Notifications (multi-channel messaging), API Resources (serialization), and named routes. <!-- @rule RL-925d -->
- Read configuration only through `config('services.stripe.key')`; call `env()` only inside files under `config/`. Config caching (`php artisan config:cache`) makes `env()` return `null` everywhere else in production. <!-- @rule RL-a133 -->
- Register middleware, route files, exception handling, and named-route middleware groups in `bootstrap/app.php` via `->withMiddleware()`, `->withRouting()`, and `->withExceptions()` (Laravel 11/12); there is no `app/Http/Kernel.php` or `app/Exceptions/Handler.php` in the new structure. <!-- @rule RL-693f -->
- Register service container bindings, observers, and policies in a service provider (`App\Providers\AppServiceProvider`); do not bootstrap that wiring inline in controllers or routes. <!-- @rule RL-c26f -->
- Schedule recurring tasks in `routes/console.php` with `Schedule::command(...)->daily()` (Laravel 11/12), not in a `Kernel::schedule()` method. <!-- @rule RL-d0d8 -->
- Dispatch slow or external work (email, third-party API calls, image processing) to a queued Job (`implements ShouldQueue`); do not block the request thread. <!-- @rule RL-e54e -->
- Use the `storage/app` filesystem disks via the `Storage` facade for file I/O; do not write to arbitrary paths with raw `file_put_contents`. <!-- @rule RL-12fd -->
- Generate scaffoldable files with artisan generators rather than hand-writing them, so namespaces, stubs, and registration stay correct. <!-- @rule RL-e94d -->
