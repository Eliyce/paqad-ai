---
name: design-system-sync
description: Sync docs/instructions/design-system/* when a token, component, or breakpoint is added to source. Mirror of canonical-doc-sync.
model_tier: medium
triggers:
  - workflow:
      - feature-development
      - design-test
      - design-retest
cacheable: false
cache_key_inputs:
  - src/design-tokens/**
  - src/components/**
  - tailwind.config.*
  - docs/instructions/design-system/**
output_format: markdown
input_schema:
  diff_paths:
    type: path[]
    required: true
    description: Changed files in the current diff that may require a design-system contract update.
---

## What It Does

When a token, component, or breakpoint is added to source (Tailwind theme entry, design-token export, new component file), this skill updates the matching contract clause in `docs/instructions/design-system/*` so the contract stays in step with reality. Mirror of `canonical-doc-sync`, scoped to the design system.

## Use This When

Use this from the `documentation_sync` stage of `feature-development.yaml` whenever the diff touches:

- `src/design-tokens/**`
- `tailwind.config.*`
- `src/components/**` (added/removed components)
- A CSS-in-JS theme provider definition

Also runs during `design-test` Step 5 when a finding's resolution implies the contract should expand (e.g. a `documentation-drift` finding noting a token used in code but not declared).

## Inputs

- Read the diff (`git diff --name-only HEAD`).
- Read the current `docs/instructions/design-system/*.md` files.
- Read `references/sync-rules.md`.

## Procedure

1. For each changed file in the diff:
   - Token source (`src/design-tokens/**`, `tailwind.config.*` theme): diff against `tokens.md`; propose appended entries for new tokens, removed entries for deleted tokens.
   - New component file under `src/components/**`: propose an entry in `components.md` with default variants/states.
   - Removed component file: propose removing the entry from `components.md`.
2. Emit a unified-diff style proposal block per file change.
3. Never auto-apply; this skill writes the proposal, the workflow's `documentation_sync` stage applies it after user confirmation (Decision Pause Contract).

## Output Contract

- Match `assets/output.template.md`: one proposal block per contract file affected, with the proposed unified diff.
- Output is advisory; this skill never emits `## Findings`.

## Escalate / Stop Conditions

- Ask when a new token replaces an existing one (e.g. `color.primary.500` value changes) — that's a contract-breaking change, not a sync.
- Warn when the diff removes a component that other components depend on per `components.md`.

## Resources

- `references/sync-rules.md`
- `assets/output.template.md`
- `agents/openai.yaml`
