---
name: runtime-surface-probing
description: Plan and interpret safe runtime checks against a locally running application.
model_tier: medium
triggers:
  - workflow:
      - pentest
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  target_url:
    type: string
    required: true
    description: Base URL for the locally running application.
  runtime_artifact_paths:
    type: path[]
    required: false
    description: Artifacts produced by runtime-check scripts.
---

## What It Does

Interprets safe browser and HTTP probe results so exposed debug, admin, and sensitive-file surfaces become actionable findings instead of raw status codes.

## Use This When

Use this during pentest runs when the local project is already running and safe runtime probes have been executed.

## Inputs

- Read the runtime artifacts first.
- Read `references/runtime-surface-checks.md` before deciding whether a reachable path is risky.
- Read stack-specific tool references for browser validation when the stack ships them.

## Procedure

1. Run `scripts/probe-surfaces.sh <base-url>` — GET-only probe of `assets/probe-paths.txt`; exits 1 if the base is unreachable.
2. Review the `status | path` output and decide which non-404 results indicate unintended public exposure vs expected local-only behavior.
3. Format findings per `assets/output.template.md` — every finding must cite path and numeric status code.
4. Validate with `scripts/lint-findings.sh`.
5. Record blocked probes (base unreachable, paths skipped) under `## Coverage Notes`, not as findings.

## Output Contract

- Match `assets/output.template.md`: severity, surface, `Path: \`/foo\``, `Status: NNN`, Required action.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when the provided target URL does not appear to correspond to the project under review.
- Warn when debug or sensitive-file paths are reachable even in local mode because deployment drift may expose them elsewhere.
- Do not escalate harmless 404s as findings.

## Resources

- `references/runtime-surface-checks.md`
- `scripts/probe-surfaces.sh`
- `scripts/lint-findings.sh`
- `assets/probe-paths.txt`
- `assets/output.template.md`
- `agents/openai.yaml`
