---
name: surface-extraction
description: Run the extractors, normalize the raw surfaces, and fingerprint the result so the site-map run has a deterministic, evidence-backed inventory of what the app exposes.
model_tier: fast
triggers:
  - workflow:
      - site-map
      - site-map-retest
cacheable: false
cache_key_inputs:
  - .paqad/site-map/baseline.json
output_format: json
input_schema:
  project_root:
    type: path
    required: true
    description: Repository root the extractors scan for surfaces (routes, commands, endpoints).
---

## What It Does

Produces the raw surface inventory the rest of the workflow builds on: every page, screen,
endpoint, or command the extractor can prove from the code, each with resolving `file:line`
evidence, deduped, and folded into a stable fingerprint. Mostly deterministic — the engine
does the scanning; this skill orchestrates it and confirms the output is clean.

## Use This When

Use this after readiness passes and before modeling. It is the bridge from "the app is
mappable" to "here is what the app exposes, with proof".

## Inputs

- The readiness verdict and detected extractor from `site-map-readiness`.
- The project source the extractor scans (route files, command programs, endpoint handlers).
- Read `references/extraction-evidence.md` before accepting or excluding a surface.

## Procedure

Extraction is deterministic — the engine owns it. Do not re-scan the code by hand.

1. Run `paqad-ai sitemap run`; it runs the extractors, dedupes, unions evidence, and computes
   the extraction fingerprint.
2. Read the `extraction.json` in the run bundle: each extracted surface carries its kind, a
   `file:line`, and a derivation (`static | convention`).
3. Confirm every surface's evidence resolves and no surface is a duplicate under a different
   label; flag any the engine could not ground rather than passing it through.

## Output Contract

- A JSON object `{ surfaces: [{ id, kind, evidence, derivation }], fingerprint, blocked_checks: [...] }`.
- Every `surfaces[]` entry carries at least one resolving `file:line` evidence pointer.
- `fingerprint` is present and stable across identical inputs.

## Escalate / Stop Conditions

- Stop and record a `blocked_checks` entry when the extractor cannot read the app shape; never
  invent a surface to fill the gap.
- Warn when the extraction is empty on a non-trivial app — that is a coverage gap, not a clean map.
- Do not promote a `convention`-derived surface to `static` confidence without resolving evidence.

## Resources

- `references/extraction-evidence.md`
- `agents/openai.yaml`
