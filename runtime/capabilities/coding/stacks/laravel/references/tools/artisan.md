# Artisan Guide

Use generator commands instead of hand-rolling framework boilerplate when Laravel already provides it.

## Preferred Commands

- Model plus migration and factory: `php artisan make:model <Name> -m -f`
- Form request: `php artisan make:request <Name>Request`
- Policy: `php artisan make:policy <Model>Policy --model=<Model>`
- PHPUnit test: `php artisan make:test <Name>Test`
- Pest test: `php artisan make:test <Name>Test --pest`
- Generic class: `php artisan make:class <Name>`

## Notes

- If the project uses Sail, run these through `docs/tools/laravel/sail.md`.
- If the project uses generic Docker Compose without Sail, run these through the matching `docker compose exec <service>` wrapper instead of assuming local PHP.
- Use `php artisan list` first when command names or flags may vary by Laravel version.
