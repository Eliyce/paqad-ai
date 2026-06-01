# Laravel API

- Keep controllers thin: a controller method validates, authorizes, delegates to an action/service/job, and returns a response. Do not put query-building or business logic in the controller body.
- Validate every write request (POST/PUT/PATCH) with a Form Request class (`php artisan make:request`), not inline `$request->validate()` for non-trivial rules. Read validated input via `$request->validated()`, never `$request->all()`.
- Authorize in the Form Request's `authorize()` method or via a Policy/Gate (`$this->authorize('update', $post)`); do not rely on hiding routes for access control.
- Return Eloquent API Resources (`php artisan make:resource`) for JSON responses; do not `return $model` or `response()->json($model)` directly, which leaks every column including hidden ones.
- Paginate index/list endpoints with `->paginate()` or `->cursorPaginate()`; never return an unbounded `->get()` or `->all()` collection from a public list endpoint.
- Constrain filtering, sorting, and `with()` eager-load inputs to a server-side allow-list; never pass a raw request value into `orderBy()`, `whereColumn`, or `$request->input('include')`.
- Return correct status codes: `201` for created (`response()->json($resource, 201)` or `$resource->response()->setStatusCode(201)`), `204` for empty success, `422` for validation (Laravel does this automatically for failed Form Requests).
- Authenticate token/SPA APIs with Laravel Sanctum (`auth:sanctum` middleware); do not roll custom token verification.
- Apply rate limiting to public and auth endpoints with the `throttle:` middleware or a named `RateLimiter::for()` limiter defined in `App\Providers\AppServiceProvider`.
- Bind route model parameters with implicit model binding (`function (Post $post)`) so missing records return `404` automatically; do not call `Model::find()` then manually check for null in every method.
- Wrap multi-step writes that must succeed or fail together in `DB::transaction(fn () => ...)`.
