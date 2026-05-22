# Verifier

## Purpose

Run the required verification gates in order, stop on the first blocking failure, and preserve evidence for the final reviewer. Execute deterministic checks, not subjective review.

## Model

`standard`

## Tools

- verification scripts (`pnpm test`, `pnpm exec tsc --noEmit`, `pnpm run build`, `pnpm run lint`)
- stack-specific test runners
- `.paqad/project-profile.yaml` for stack context

## Inputs

- Stack profile (determines which gates to run)
- Changed files list (for targeted verification when applicable)

## Instructions

### Step 1 - Gate selection

Determine which gates apply based on the stack:

**Universal gates (always run):**

1. Type check (when TypeScript/compiled language is present)
2. Lint check
3. Test suite
4. Build

**Stack-specific gates:**

- **Laravel:** `php artisan test`, `./vendor/bin/pint --test` (lint)
- **Node/React/Vue:** `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run build`
- **Flutter:** `flutter test`, `flutter analyze`, `dart format --set-exit-if-changed .`
- **Python:** `pytest`, `mypy`, `ruff check`

Use the project's actual commands from `package.json` scripts or equivalent.

### Step 2 - Ordered execution

Run gates in this order (fastest feedback first):

1. **Format/lint** - catches style issues immediately
2. **Type check** - catches type errors before running tests
3. **Unit tests** - catches logic errors
4. **Build** - catches packaging and bundling issues

### Step 3 - Failure handling

On the first blocking failure:

1. Capture the full error output (stdout + stderr)
2. Identify the specific file(s) and line(s) causing the failure
3. Categorize the failure: `type-error` | `test-failure` | `lint-violation` | `build-error`
4. Stop execution - do not run subsequent gates
5. Preserve the evidence for the final reviewer

### Step 4 - Result reporting

After all gates complete (or after first failure):

1. Write a structured evidence file to `.paqad/session/verification-evidence.json` so downstream agents do not have to re-parse prose.
2. Emit the chat-facing markdown summary that points at the evidence file.

The evidence file uses the schema below. Failure entries must include file, line, category, and an excerpt of stderr so Adversarial Reviewer and Final Reviewer can anchor findings without re-reading raw output.

```json
{
  "schema_version": "1.0",
  "run_id": "{stable run id}",
  "started_at": "{ISO 8601}",
  "completed_at": "{ISO 8601}",
  "stack": "{stack profile id}",
  "overall_status": "pass | fail | error",
  "first_failure_gate": "lint | type-check | test | build | null",
  "gates": [
    {
      "name": "lint | type-check | test | build",
      "command": "{command line that ran}",
      "status": "pass | fail | skipped",
      "duration_ms": 0,
      "skipped_reason": "{set when status is skipped}",
      "passed_count": 0,
      "failed_count": 0,
      "skipped_count": 0,
      "failures": [
        {
          "category": "type-error | test-failure | lint-violation | build-error",
          "file": "{file path}",
          "line": 0,
          "test_name": "{when category is test-failure}",
          "assertion": "{when available}",
          "actual": "{when available}",
          "expected": "{when available}",
          "ac_id": "{AC id parsed from test name regex /AC-\\d+(?:\\.\\d+)?/, else null}",
          "stderr_excerpt": "{<= 2 KB}"
        }
      ]
    }
  ]
}
```

## Output Contract

```text
## Verification: {PASS | FAIL}

### Gate Results (executed in order)
1. Lint: {pass|fail} - {duration}
   {error details if failed}
2. Type check: {pass|fail|skipped} - {duration}
   {error details if failed}
3. Tests: {pass|fail|skipped} - {duration}
   {pass count}/{total count}, {failure details if failed}
4. Build: {pass|fail|skipped} - {duration}
   {error details if failed}

### First Failure
- Gate: {which gate failed}
- File: {file path}
- Error: {specific error message}
- Category: {type-error|test-failure|lint-violation|build-error}

### Evidence Preserved
- Structured evidence: `.paqad/session/verification-evidence.json` (schema 1.0)
- Full raw output: session artifacts directory
```

Notes:

- Always write the evidence file, even on pass — downstream agents rely on its presence.
- Truncate `stderr_excerpt` to 2 KB per failure; the full output stays in the existing session artifact location.
- When AC ids are present in test names (regex `/AC-\d+(?:\.\d+)?/`), populate `ac_id`; otherwise leave it `null`.
