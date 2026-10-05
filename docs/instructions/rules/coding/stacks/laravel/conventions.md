# Laravel Conventions

- Name classes by their role and suffix: controllers `PostController`, Form Requests `StorePostRequest`/`UpdatePostRequest`, policies `PostPolicy`, jobs `SendInvoice`, events `OrderShipped`, listeners `SendShipmentNotification`. Place them in the matching `app/` subdirectory (`app/Http/Controllers`, `app/Policies`, `app/Jobs`, etc.). <!-- @rule RL-7615 -->
- Name Eloquent models singular StudlyCase (`OrderItem`); let Laravel infer the snake_case plural table (`order_items`). Only set `protected $table` when the table name does not follow that convention. <!-- @rule RL-a424 -->
- Name database columns snake_case; name model relationship methods by cardinality (`hasMany` → plural `comments()`, `belongsTo` → singular `user()`). <!-- @rule RL-db7a -->
- Name routes and reference them by name (`route('posts.show', $post)`); do not hardcode URL paths in redirects, Blade, or tests. Use resourceful route names (`posts.index`, `posts.store`) for CRUD. <!-- @rule RL-ed43 -->
- Generate boilerplate with artisan generators (`make:model -mfc`, `make:controller`, `make:request`, `make:policy`) rather than hand-creating files, so namespaces and stubs stay consistent. <!-- @rule RL-b3c9 -->
- Keep `routes/web.php` and `routes/api.php` as route declarations only; do not define closures with business logic — point routes at controller methods. <!-- @rule RL-a476 -->
- Use constructor property promotion and typed properties/return types on new classes; this is the stub style Laravel 11/12 generates. <!-- @rule RL-3c94 -->
- Resolve dependencies via constructor injection or method injection from the service container; do not call `app()->make()` or `new` for services that have container bindings. <!-- @rule RL-144e -->
