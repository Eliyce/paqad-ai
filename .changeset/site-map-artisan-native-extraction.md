---
'paqad-ai': minor
---

**Site Map — framework-native Laravel surface extraction** (behind the OFF-by-default `site_map`
flag). The dedicated extractors now ask the framework instead of grepping fixed directories:

- **Artisan-first routes** — `paqad-ai sitemap run` runs `php artisan route:list --json` when it
  can, so modular routes (`nwidart/laravel-modules` and bespoke `Modules/*/Routes/` layouts) are
  mapped through the real router, route middleware is carried as guard hints, and each surface is
  attributed to its owning module from the controller namespace. When artisan cannot run (no PHP,
  or the app will not boot) the run degrades to a modular-aware static route scan and records a
  labelled blocked check — never a crash, never a silent pass.
- **New non-HTTP surfaces** — artisan/console commands (`php artisan list`) become `cli-command`
  surfaces, scheduled tasks (`php artisan schedule:list`) become `job` surfaces, and a
  modular-aware static scan maps queued jobs (`ShouldQueue`) to `job` surfaces and mailables /
  notifications to `email` surfaces.

Artisan is best-effort, timeout-bounded, and read-only (`route:list`, `list`, `schedule:list`).
The pure mappers and parsers are at 100% branch coverage; the shell-out and file globbing live in
the coverage-excluded gatherer.
