# Laravel Database

- Make every schema change through a migration (`php artisan make:migration`); never edit an already-shipped migration to alter a deployed schema — add a new migration instead. <!-- @rule RL-8d4d -->
- Give each migration a working `down()` that reverses `up()`, or use `Schema::dropIfExists()` for table-creating migrations, so rollbacks are safe. <!-- @rule RL-d215 -->
- Add an index for every column used in a `where`, `orderBy`, or join filter, and for every foreign key. Use `$table->foreignId('user_id')->constrained()` to create the column, index, and FK constraint together. <!-- @rule RL-85a7 -->
- Cast attributes with the `casts()` method (Laravel 11/12) or the `$casts` property: `'is_active' => 'boolean'`, `'meta' => 'array'`, `'published_at' => 'datetime'`, money as `'amount' => 'decimal:2'`. Do not store JSON as a plain string and `json_decode` it by hand. <!-- @rule RL-1109 -->
- Prevent N+1 queries: eager-load relations accessed in loops or resources with `->with('author', 'comments')`. Enable `Model::preventLazyLoading()` in `AppServiceProvider::boot()` (non-production) to catch lazy loads in tests. <!-- @rule RL-ec27 -->
- Process large result sets with `->chunkById()`, `->lazy()`, or `->cursor()`; never load an unbounded table into memory with `->get()` or `->all()`. <!-- @rule RL-1800 -->
- Aggregate counts with `->withCount('comments')` or `loadCount()`; do not call `$model->comments->count()` inside a loop. <!-- @rule RL-1cc8 -->
- Use query bindings — `where('email', $email)`, `whereIn(...)` — for all user input. If you must use `DB::raw()` or `whereRaw()`, pass values as bindings, never string-interpolate them. <!-- @rule RL-c219 -->
- Wrap multi-statement writes in `DB::transaction(fn () => ...)`; for jobs/concurrency-sensitive reads use `lockForUpdate()` inside the transaction. <!-- @rule RL-62d3 -->
- Define mass-assignable columns with `$fillable` (or guard with `$guarded`) on every model before using `create()`/`update()` with request data. <!-- @rule RL-3136 -->
- Seed reference/test data through seeders and model factories (`database/factories`, `database/seeders`), not raw SQL or `DB::insert` in migrations. <!-- @rule RL-8b82 -->
