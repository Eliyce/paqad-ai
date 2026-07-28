# Site Map — framework-native Laravel surface extraction (spec)

Follow-up to the shipped React/Laravel route extractors (#443). Route/job/mail surfaces are
extracted by grepping fixed directories with static regex, which misses modular routes
(`nwidart/laravel-modules`), middleware guards, and non-HTTP surfaces (jobs, console commands,
scheduled tasks, mailables). The framework already knows its own surfaces — so we ask it. All
behaviour stays behind the OFF-by-default `site_map` flag and the coding capability.

## Functional requirements

- FR-1: A pure `extractLaravelArtisanRoutes` maps normalized `php artisan route:list --json`
  entries to `page`/`api` surfaces (by uri prefix) with resolving evidence, high confidence,
  each route's middleware carried as `guards[]` hints, and controller-namespace module
  attribution when the action lives under `Modules\<Name>\...`.
- FR-2: A pure `extractLaravelConsoleCommands` maps `php artisan list --format=json` command
  entries to `cli-command` surfaces; a pure `extractLaravelScheduledJobs` maps `schedule:list`
  task lines to `job` surfaces.
- FR-3: Pure `extractLaravelJobs` / `extractLaravelMailables` map modular-aware class-scan
  records (`app/Jobs`, `Modules/*/Jobs`, `app/Mail`, `Modules/*/Mail`, …) to `job` / `email`
  surfaces respectively.
- FR-4: Pure parsers `parseArtisanRouteList` / `parseArtisanCommandList` /
  `parseArtisanScheduleList` normalize raw artisan stdout into the mapper record shapes and
  never throw on malformed output (they return an empty list).
- FR-5: All new surfaces feed the same `assembleExtraction` dedupe/fingerprint/blocked-check
  path as the existing extractors.
- FR-6: The impure, coverage-excluded gatherer runs artisan first (timeout-bounded, read-only
  commands only) and, on any failure, degrades to the modular-aware static scan plus a labelled
  `blocked_check` — never a crash, never a silent pass.

## Invariants

- INV-1: With the `site_map` flag off (the default) nothing changes — the extractors only run
  inside the flagged verb's gatherer.
- INV-2: Every extracted surface carries at least one `file:line` (or artisan-source) evidence
  pointer; a mapper never emits a surface it cannot ground.
- INV-3: Artisan is best-effort and read-only: only `route:list`, `list`, `schedule:list`, and
  `about` are ever run; a boot failure or timeout degrades to the static scan, it never fails
  the run.

## Acceptance criteria

- AC-1: `extractLaravelArtisanRoutes` maps a modular route (action under `Modules\Blog\...`) to a
  surface whose `module` is `Blog` and whose `guards` include each middleware token, splitting
  `api/`-prefixed uris to the `api` kind and the rest to `page`.
- AC-2: `extractLaravelConsoleCommands` emits `cli-command` surfaces (skipping hidden/`_`
  internal commands); `extractLaravelScheduledJobs` emits `job` surfaces from parsed cron lines.
- AC-3: `extractLaravelJobs` emits `job` surfaces and `extractLaravelMailables` emits `email`
  surfaces from modular class-scan records, each with resolving `file:line` evidence.
- AC-4: `parseArtisanRouteList` / `parseArtisanCommandList` / `parseArtisanScheduleList` return
  normalized records for well-formed output and an empty list for malformed output, without
  throwing.
- AC-5: Every new mapper's output flows through `assembleExtraction` so surfaces are deduped and
  fingerprinted alongside the existing extractors.
- AC-6: Pure mappers and parsers are at 100% branch coverage; the artisan shell-out and the
  modular file globbing live in the coverage-excluded gatherer.
