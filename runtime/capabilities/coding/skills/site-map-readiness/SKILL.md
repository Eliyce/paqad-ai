---
name: site-map-readiness
description: Grade whether the project is mappable — app kind, frameworks, and an extractor that covers its shape — and route the unmappable case before any other site-map skill runs.
model_tier: fast
triggers:
  - workflow:
      - site-map
      - site-map-retest
cacheable: false
cache_key_inputs:
  - .paqad/project-profile.yaml
output_format: json
input_schema:
  project_root:
    type: path
    required: true
    description: Repository root whose manifests and profile establish the app kind and frameworks.
---

## What It Does

Confirms the project is mappable before the workflow spends any effort: the app kind and
frameworks are detectable, and at least one extractor covers the app's shape. Emits a
readiness verdict (`ready | partial | blocked`) that gates everything downstream. Runs first,
like `design-system-coverage` gates the design-test workflow.

## Use This When

Use this as the **first skill in every site-map run**. Never run extraction, modeling, or
verification without a `ready` or `partial` verdict from it.

## Inputs

- Read `.paqad/project-profile.yaml` for the detected `active_capabilities` and `stack_profile`.
- Read the project manifests the profile points at (`package.json`, `composer.json`, lockfiles).
- Read `references/readiness-criteria.md` before grading.

## Procedure

The verdict is a deterministic function of what the engine can detect — drive it from the
engine, do not re-derive detection in prose.

1. Run `paqad-ai sitemap run` and read the `readiness` and `blocked_checks` it reports; the
   engine owns app-kind and framework detection.
2. Grade the verdict: `ready` when an extractor covers the app shape, `partial` when only the
   generic convention fallback applies, `blocked` when no extractor covers the shape.
3. Emit the readiness inventory (app kind, frameworks, extractor, verdict, blocked reasons).

## Output Contract

- A JSON object `{ app_kind, frameworks: [...], extractor, verdict, blocked_checks: [...] }`.
- `verdict` ∈ `ready | partial | blocked`.
- A `blocked` verdict must carry at least one `blocked_checks` entry with a reason.

## Escalate / Stop Conditions

- Stop when the verdict is `blocked`: surface the engine's `blocked_checks` reason and do not
  fabricate surfaces to fill the gap.
- Warn when the verdict is `partial`: downstream skills run in exploratory mode and tag
  surfaces `confidence: low`.
- Do not upgrade a `partial` verdict to `ready` to unblock the run.

## Resources

- `references/readiness-criteria.md`
- `agents/openai.yaml`
