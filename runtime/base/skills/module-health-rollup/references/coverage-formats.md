# Supported Coverage / Test Report Formats

The module-health rollup understands a fixed set of report formats, mirrored
by the `coverage_format` / `test_report_format` enum on
`module_health` blocks in stack-pack manifests (spec AC #21).

| Format            | Kind        | Typical tooling                            |
| ----------------- | ----------- | ------------------------------------------ |
| `lcov`            | coverage    | Vitest (c8), Jest (c8), istanbul, gcov     |
| `cobertura`       | coverage    | nyc, .NET Coverlet, generic CI uploaders   |
| `coverage-py-xml` | coverage    | Python `coverage xml`                      |
| `gocover`         | coverage    | `go test -coverprofile=…`                  |
| `junit-xml`       | test report | Vitest, Jest, pytest, surefire, gradle     |
| `go-json`         | test report | `go test -json`                            |
| `jacoco`          | coverage    | JVM (Maven/Gradle JaCoCo plugin)           |
| `opencover`       | coverage    | .NET OpenCover / Coverlet (opencover mode) |
| `vitest-json`     | test report | `vitest --reporter=json`                   |

## No fabricated metrics

Every shipped pack should set `coverage_format` + `coverage_path` and a
`test_report_format` + `test_report_path` when the stack supports them.
When a signal is missing the rollup writes `null` and records the reason in
`blocked_metrics` (e.g. `coverage:not_configured`,
`tests:report_missing:<path>`, `contract_stability:no_public_api_extractor`).
The rollup never zeroes a metric to avoid the null path.

## No project-side parsers

Extending the parser set is a framework PR (spec AC #28). A project that
ships its own coverage tooling either picks the closest existing format or
opens an issue for the new one — `module_health.coverage_format` is gated by
a closed JSON-Schema enum in
[`src/validators/schemas/stack-pack.schema.json`](src/validators/schemas/stack-pack.schema.json).

## Where each parser lives

All parsers are framework-shipped under
[`src/module-health/parsers/`](src/module-health/parsers). Each file
exports a single `parseReport(content: string): ParsedReport`. The registry
is built once in
[`src/module-health/parsers/index.ts`](src/module-health/parsers/index.ts);
the rollup engine calls `getParser(format)` and surfaces
`parser_missing:<format>` as a blocked metric when the lookup returns null
(used by the test path; should never be hit in production because the schema
constrains the enum to the implemented set).
