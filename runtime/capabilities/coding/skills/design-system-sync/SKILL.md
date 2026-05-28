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

Proposal generation is deterministic — the scripts produce unified-diff hunks
ready for the Decision Pause Contract. The LLM never hand-writes the diff.

1. Capture the current diff: `git diff HEAD > /tmp/sync.diff` (or read from the workflow's staged diff).
2. Run `scripts/detect-token-additions.sh /tmp/sync.diff` → `<key>\t<value>` rows for every added token-shaped entry (accepts identifier and quoted-numeric keys; only token-shaped values: hex/px/rem/em).
3. Pipe those rows into `scripts/propose-tokens-diff.sh` → a unified-diff hunk targeting `docs/instructions/design-system/tokens.md`. Surface this hunk to the user via the Decision Pause Contract.
4. Run `scripts/detect-component-additions.sh /tmp/sync.diff` → `<Component>\t<source-file>` rows for every newly-added component file (uppercase-named, under `src/components/`, not a test/spec/story/barrel/type decl).
5. Pipe those rows into `scripts/propose-components-diff.sh` → a unified-diff hunk for `components.md` with the default skeleton (variants: TBD, states: default/hover/focus/disabled, composition: TBD).
6. Never auto-apply. Surface every proposal via the Decision Pause Contract; the user accepts, modifies, or rejects each.

## Output Contract

- Match `assets/output.template.md`: one proposal block per contract file affected, with the proposed unified diff.
- Output is advisory; this skill never emits `## Findings`.

## Escalate / Stop Conditions

- Ask when a new token replaces an existing one (e.g. `color.primary.500` value changes) — that's a contract-breaking change, not a sync.
- Warn when the diff removes a component that other components depend on per `components.md`.

## Resources

- `references/sync-rules.md`
- `scripts/detect-token-additions.sh` — extract added token-shaped `<key>: '<value>'` entries from a unified diff.
- `scripts/detect-component-additions.sh` — extract newly-added component files from a unified diff.
- `scripts/propose-tokens-diff.sh` — render a unified-diff hunk appending tokens to `tokens.md`.
- `scripts/propose-components-diff.sh` — render a unified-diff hunk appending components (with default skeleton) to `components.md`.
- `scripts/lint-findings.sh` — used when sync emits a `documentation-drift` finding inside the design-test workflow.
- `assets/output.template.md`
- `agents/openai.yaml`
