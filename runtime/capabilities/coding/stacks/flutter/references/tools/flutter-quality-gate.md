# Flutter Quality Gate Guide

Use this order after code changes.

## 1. Format

- `dart format --set-exit-if-changed .`

## 2. Analyze

- `flutter analyze`

## 3. Test

- targeted scope: `flutter test test/<path_or_file>.dart`
- full suite: `flutter test`

## 4. Recovery Steps When UI Looks Stale

- `flutter pub get`
- hot restart or full restart
- if needed: `flutter clean && flutter pub get`

## Containerized Projects

- if the project uses Docker Compose, run Flutter commands through the matching `docker compose exec <service>` wrapper instead of assuming a local SDK

Use the narrowest command first during development, then run the broader quality gate before handoff or release.
