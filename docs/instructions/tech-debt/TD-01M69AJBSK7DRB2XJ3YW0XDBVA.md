---
id: "TD-01M69AJBSK7DRB2XJ3YW0XDBVA"
title: "Skill reference checks: framework console commands and non-JSON/YAML examples are not verified"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/authoring/tests/reference-checks.ts"
found_in:
  change: "01M6968HSVNBV1X20K3ANPE472"
  issue: null
  stage: "checks"
found_by: "development"
session: "ec34a7d7-3ffc-45bc-bcad-4e805868ea1d"
created_at: "2026-10-31T15:52:03.605Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The skill reference check (src/authoring/tests/reference-checks.ts) verifies named commands only where the project declares them in a file paqad can read without running anything: npm, pnpm, yarn and composer scripts, and make and just targets. Framework console commands (`php artisan <cmd>`, `python manage.py <cmd>`, `bundle exec rake <task>`, `go run`) are registered in code, so checking them would mean booting the app. Examples that are not JSON or YAML (Blade, Twig, Jinja templates, TOML, XML) are not validated either; the check asks for a `human-verified: <date>` marker instead.

Follow-up: decide whether to list framework commands through a cached, opt-in run (for example `php artisan list --format=json`) and add TOML/XML parsers.
