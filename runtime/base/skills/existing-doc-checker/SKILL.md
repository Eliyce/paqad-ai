---
name: existing-doc-checker
description: Inspect canonical docs and registries before new artifacts are written.
model_tier: medium
triggers:
  - workflow:
      - feature-development
      - bug-fix
      - refactor
      - migration
      - investigation
cacheable: true
cache_key_inputs:
  - docs/**/*.md
  - .paqad/indexes/**/*.json
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Incoming request to reconcile against existing docs.
  candidate_doc_paths:
    type: path[]
    required: true
    description: Canonical docs to inspect.
---

## What It Does

Finds the canonical docs, registries, and previously generated artifacts that already describe the requested area so new work starts from the current documented truth.

## Use This When

Use this before creating or rewriting docs, plans, or implementation notes whenever there is any chance the project already has a canonical source for the topic.

## Inputs

- Read the request and identify affected modules, flows, registries, or interfaces.
- Read `.paqad/indexes/registry-status.json` if present to discover generated surfaces quickly.
- Read `references/doc-scan-order.md` before scanning the docs tree.

## Procedure

1. Walk surfaces in the order in `assets/scan-order.txt` — registries / module indexes first, then per-module support docs.
2. Pipe topic keywords into `scripts/scan-docs.sh <keyword> ...` to enumerate canonical doc hits.
3. Classify each hit as canonical, drifted, or missing based on freshness and stated ownership.
4. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Canonical Files`, `## Potential Drift`, `## Missing Docs`.
- File paths must be backticked relative repo paths.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when multiple docs conflict and the canonical owner is unclear.
- Warn when requested behavior appears undocumented across a critical system boundary.
- Do not mark a file canonical if it is clearly a scratch note or obsolete artifact.

## Resources

- `references/doc-scan-order.md`
- `scripts/scan-docs.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/scan-order.txt`
- `.paqad/indexes/registry-status.json`
- `agents/openai.yaml`
