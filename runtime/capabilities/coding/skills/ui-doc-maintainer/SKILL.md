---
name: ui-doc-maintainer
description: Maintain UI screens, components, and state docs after UI changes.
model_tier: medium
triggers:
  - ui_impact:
      - new-component
      - new-screen
      - redesign
cacheable: true
cache_key_inputs:
  - docs/modules/*/ui/*.md
  - src/components/**
output_format: markdown
input_schema:
  changed_files:
    type: path[]
    required: true
    description: UI implementation files that changed.
  ui_doc_paths:
    type: path[]
    required: true
    description: Canonical UI docs to update.
---

## What It Does

Maintains the canonical UI docs for screens, components, and states so interface changes are documented as one coherent system rather than scattered notes.

## Use This When

Use this after UI behavior or structure changes and before handoff closes, especially when new states, variants, or screen responsibilities were introduced.

## Inputs

- Read the affected `docs/modules/*/ui/*.md` files first.
- Read the changed UI implementation and any current flow or state docs.
- Read `references/ui-doc-fields.md` before editing canonical UI docs.

## Procedure

1. Run `scripts/find-ui-docs.sh` to enumerate canonical per-module UI docs.
2. Identify which docs are stale relative to the change.
3. For each new/changed component, fill `assets/component-entry.template.md` (Responsibility, Props, States, Variants, A11y, Used by) — never partial.
4. Update screens, components, and states in one pass; reference shared patterns instead of duplicating prose.
5. Format report per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Return sections named `Updated UI Docs` and `Open UI Gaps`.
- List each changed doc file in backticks with the doc facet updated: screen, component, or state.
- If all gaps are resolved, write `Open UI Gaps: none`.

## Escalate / Stop Conditions

- Ask when the intended ownership of a screen or component is unclear from the request or code.
- Warn when the interface has visible states that cannot be documented confidently from the available evidence.
- Do not create placeholder component contracts without props, states, or usage context.

## Resources

- `references/ui-doc-fields.md`
- `scripts/find-ui-docs.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/component-entry.template.md`
- `runtime/capabilities/coding/checklists/edge-cases-coding.md`
- `agents/openai.yaml`
