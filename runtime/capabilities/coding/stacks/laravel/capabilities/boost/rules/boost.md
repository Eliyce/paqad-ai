# Laravel Boost

- Use Boost scaffolding commands to generate modules; do not create module directories manually.
- Follow the Boost module structure: keep controllers, models, requests, resources, and policies within the module boundary.
- Register module service providers and routes through the Boost module registry; do not register them directly in `bootstrap/app.php` or `routes/web.php`.
- Use Boost's built-in authorization layer; align policy names and abilities with the conventions in `docs/tools/laravel/boost.md`.
- Keep module migrations within the module directory; do not place Boost module migrations in the global `database/migrations/` directory.
- Use Boost's module testing helpers; align test namespaces with the module under test.
- Document every Boost module in the corresponding module index file following the structure in `docs/modules/`.
- Do not bypass Boost lifecycle hooks; extend them through the provided extension points.
