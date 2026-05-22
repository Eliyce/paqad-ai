# Laravel Code Quality Guide

Use the project-standard commands first. If scripts are unclear, inspect `composer.json` and `package.json` before inventing new command flows.

## Backend

- Preferred formatter: `vendor/bin/pint` or the project's Composer wrapper
- Run lint/static analysis through the project's defined scripts when present
- Re-run focused checks after each backend edit batch touching policies, requests, resources, or jobs

## Frontend

- Run the project's frontend lint and format scripts when present
- Keep browser-facing UI checks aligned with the project's JS/TS toolchain

## Review Priorities

- authorization and request validation
- raw query and N+1 regressions
- large mixed-responsibility files
- stale module/API/error documentation
