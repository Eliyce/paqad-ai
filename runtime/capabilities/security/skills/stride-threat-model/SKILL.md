---
name: stride-threat-model
description: Enumerate threats systematically using STRIDE before scripted checks run so all downstream findings map to a threat category.
model_tier: reasoning
triggers:
  - workflow:
      - pentest
cacheable: false
cache_key_inputs:
  - docs/modules/**
  - docs/instructions/**
output_format: json
input_schema:
  module_doc_paths:
    type: path[]
    required: true
    description: Module docs describing assets, workflows, integrations, and user actions.
---

## What It Does

Runs STRIDE threat enumeration across all project modules **before** any scripted checks execute. Every downstream finding produced in Steps 2–4 must map back to a STRIDE category from this inventory, giving the final report a coherent threat narrative instead of a list of isolated issues.

## Use This When

Use this as the **first skill in Step 1** so all subsequent skills have a threat inventory to reference. Always run it — even for small projects.

## Inputs

- Read all module docs to identify assets (data stores, tokens, sessions, API keys, user actions, background jobs, external integrations).
- Read `references/stride-checklist.md` before starting enumeration.

## Procedure

1. Run `scripts/list-modules.sh` to enumerate canonical module slugs.
2. For each module, identify assets (data entities, user-facing actions, background jobs, external integrations, tokens/sessions).
3. Walk every STRIDE category in `assets/stride-prompts.txt` against each asset; never skip a category silently.
4. Build the inventory per `assets/output.template.json` and write it to `.paqad/pentest/runs/<run_id>/artifacts/stride-threats.json`.
5. Validate with `scripts/validate-threats.sh` — enforces required fields, allowed STRIDE category, severity vocabulary, ≤50 entries, and rejects generic/boilerplate threat descriptions.
6. Downstream skills (`input-validation-review`, `auth-mechanism-review`, `permission-boundary-review`, `finding-normalizer`) consume this inventory.

## Output Contract

- Match `assets/output.template.json`: JSON array of `{ module, asset, stride_category, threat_description, severity_hint }` entries.
- `stride_category` ∈ `spoofing | tampering | repudiation | information-disclosure | denial-of-service | elevation-of-privilege`.
- `severity_hint` ∈ `critical | high | medium | low`.
- Cap at 50 entries ordered critical → high → medium.
- Output must pass `scripts/validate-threats.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when module docs do not describe any assets or workflows — cannot enumerate threats without context.
- Warn when no module docs exist at all — fall back to enumerating threats from route inventory alone.
- Do not produce generic STRIDE boilerplate; every threat entry must name a specific module, asset, or route.

## Resources

- `references/stride-checklist.md`
- `scripts/list-modules.sh`
- `scripts/validate-threats.sh`
- `assets/output.template.json`
- `assets/stride-prompts.txt`
