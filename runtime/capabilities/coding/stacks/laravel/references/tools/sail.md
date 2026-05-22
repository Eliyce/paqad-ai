# Laravel Sail Guide

Use Sail when the target project runs Laravel inside containers.

## Common Patterns

- Start services: `vendor/bin/sail up -d`
- Stop services: `vendor/bin/sail stop`
- Artisan: `vendor/bin/sail artisan <command>`
- Composer: `vendor/bin/sail composer <command>`
- Node: `vendor/bin/sail npm run <script>`

## Use Sail When

- PHP extensions, services, or databases are container-managed
- local host tooling differs from the project runtime
- commands need the same environment as CI or teammates

If the project does not use Sail, use its documented local execution path instead.
If the project only uses plain Docker Compose, use Compose wrappers rather than Sail commands.
