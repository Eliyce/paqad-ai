# Laravel Runtime

- Reach for a framework primitive before custom infrastructure: Form Requests, Policies/Gates, Jobs, Events/Listeners, Notifications, API Resources, and named routes.
- Read config through `config('key')` everywhere; call `env()` only inside `config/` files, because `php artisan config:cache` makes `env()` return `null` at runtime.
- Configure middleware, routing, and exception handling in `bootstrap/app.php` (Laravel 11/12) via `->withMiddleware()`/`->withRouting()`/`->withExceptions()`; there is no `app/Http/Kernel.php`.
- Register scheduled tasks in `routes/console.php` with `Schedule::command(...)`; register bindings, observers, and gates in `App\Providers\AppServiceProvider`.
- Dispatch slow or external work to a queued Job (`implements ShouldQueue`); keep `handle()` idempotent and tune `$tries`/`$backoff`/`uniqueId()` so retries are safe.
- Add a model factory for every new model and use `casts()`/`$casts`, `$fillable`, and typed relationships on the model.
- Generate scaffoldable files with artisan generators (`make:model -mfc`, `make:request`, `make:policy`, `make:resource`) so namespaces and stubs stay consistent.
- Resolve dependencies through constructor/method injection from the container; do not `new` up classes that have container bindings.
