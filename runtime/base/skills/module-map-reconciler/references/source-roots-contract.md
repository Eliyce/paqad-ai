# source_roots Contract

The reconciler refuses to run unless the active stack pack declares
`module_health.source_roots`. There is **no silent fallback** to
`module-map.yml`'s `sources:` paths (issue #80 spec AC #17).

## Why no fallback

- `module-map.yml`'s `sources:` describes what is **declared**. If the
  reconciler falls back to it, it can never detect undeclared modules
  (the entire purpose of `MM-ADD`).
- A user who has not configured `module_health.source_roots` has
  implicitly opted out of reconciliation — surfacing the missing config is
  the right user-facing signal.

## Shape

In each `pack.yaml`:

```yaml
module_health:
  source_roots:
    - src
    - lib
  source_globs:
    - "**/*.ts"
    - "**/*.tsx"
  public_api_extractor: null      # optional; enables MM-RENAME
  test_command: pnpm test
  coverage_format: lcov           # one of: lcov, cobertura, coverage-py-xml,
                                  # gocover, junit-xml, go-json, jacoco,
                                  # opencover, vitest-json
  coverage_path: coverage/lcov.info
  test_report_format: junit-xml
  test_report_path: coverage/junit.xml
```

`source_roots` is the only required key for the reconciler. The rest are
consumed by Phase 3 (module-health rollup).

## Hard-fail behaviour

When the reconciler is invoked with `source_roots: null` (or an empty
array), it writes the following report and exits:

```json
{
  "generated_at": "<ts>",
  "source_roots": [],
  "findings": [],
  "counts": { ... },
  "blocked": "source_roots_unknown"
}
```

Callers (`paqad-ai status`, `paqad-ai refresh`,
`feature-development.documentation_sync`) treat the `blocked` field as a
hard signal — they do not retry with a guessed source_roots.
