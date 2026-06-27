# Debounce Marker — Technical View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `debounce-marker`

## Module Boundaries

- `src/background/debounce-marker.ts` — `shouldDebounce`, `touchMarker`.

## Entry Points

- `shouldDebounce(markerPath, debounceMs, now = Date.now): boolean`
- `touchMarker(markerPath, now = Date.now): void`

## Data Model / Schema

The marker is an empty file at `markerPath`; only its mtime is meaningful.

## API / Interface Contract

- `shouldDebounce` returns `false` when `debounceMs <= 0` or the marker is absent;
  otherwise `now() - mtimeMs < debounceMs`.
- `touchMarker` `mkdirSync(dirname)` then `utimesSync(markerPath, s, s)`; if the
  marker does not exist it is created with `writeFileSync('')` then `utimesSync`.
- `now` is injectable (seconds for `utimes`, ms for comparison) for deterministic tests.

## State Management

- The marker is stamped by `triggerRefresh` immediately before spawning, so the
  window is anchored to spawn time, not build-completion time.

## Failure Modes

- `statSync` failure (no marker) → not debounced (first run behaviour).
- `utimes` failure on an exotic filesystem → the prior `writeFileSync` mtime stands.

## Tests

- `tests/unit/background/debounce-marker.test.ts` — first-run false, in-window true,
  elapsed-window false, disabled (`<=0`) false, create-and-stamp, advance-in-place.
