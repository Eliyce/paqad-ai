# Skill orchestrator e2e fixtures

Two small projects for `tests/e2e/skill-orchestrator.e2e.test.ts`. Each holds a skill
(`skill/`) with one script, and the seven named contract tests for that script
(`skill-tests/`), which the e2e copies into the stack's skill test folder.

- `npm-project`: the script is `scripts/extract.ts` and its tests run under Vitest. The e2e
  reuses this repository's own Vitest, so nothing is installed at test time.
- `laravel-project`: the script is `scripts/extract.php` and its tests are Pest tests under
  `tests/Feature/Skills/ProcessingInvoices/`, run with `php artisan test`. Its `vendor/` is not
  committed: the dedicated CI job runs `composer install` before the tests. Without `php` or
  `vendor/autoload.php` the Laravel half skips with a stated reason.
