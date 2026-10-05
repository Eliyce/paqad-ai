# Laravel Testing Guide

Use the narrowest command that proves the changed behavior, then expand to the broader gate before merge or release.

## Common Commands

- Focused Laravel test: `php artisan test --filter="..."`
- One file: `php artisan test tests/Feature/ExampleTest.php`
- Full suite: `php artisan test`
- PHPUnit direct run when the project uses it: `./vendor/bin/phpunit`
- Pest direct run when the project uses it: `./vendor/bin/pest`
- Generic Compose example when the project is containerized without Sail: `docker compose exec <php-service> php artisan test`

## Coverage Expectations

- Cover happy path plus the important blocked, validation, or not-found paths
- Add browser or end-to-end coverage for changed user-facing flows when the project already supports it
- Keep module docs aligned with the tests that prove the changed behavior

## Release Checks

- run the changed test scope first
- run the package/project CI gate before merge
- record any explicit test waiver in project docs or the active tracker if one exists
