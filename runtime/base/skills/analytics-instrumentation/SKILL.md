---
name: analytics-instrumentation
description: When the `analytics_instrumentation` flag is on and the classify-time gate resolved to `instrument`, this skill wires a feature's analytics the tracking-plan-as-code way (issue #279). The LLM only names the event (following the project's one consistent convention) and writes the doc body; the bundled `instrument.mjs` script computes the normalized slug and the module-owned doc path, writes the per-event doc and refreshes the per-module index via the framework's doc-tree primitives, and prints the provider tracking-call snippet. A brand-new event is never added silently — it goes through the `analytics.new_event` Decision Pause first. Scales to N providers by data (one doc, a section per provider), not by code.
model_tier: fast
triggers:
  - workflow:
      - feature-development
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  project_root:
    type: path
    required: true
    description: Project root used to resolve the docs tree and read the analytics decision sidecar.
  module:
    type: string
    required: true
    description: Module slug the event belongs to (from the module map).
  feature:
    type: string
    required: true
    description: Feature slug the event belongs to.
  event:
    type: string
    required: true
    description: The exact event name, in the project's one consistent convention.
  provider:
    type: string
    required: true
    description: One or more analytics provider ids the event fires to (repeatable).
---

# Analytics instrumentation

## What It Does

Turns "add tracking for this feature" into the governed, documented, drift-resistant flow paqad
promises: it names and documents each event as a reviewed per-event doc, governs every new event
through a Decision Pause, and emits the provider tracking-call to paste into the source.

## Use This When

Analytics is enabled (`analytics_instrumentation` on) and the classify-time gate wrote
`.paqad/planning/analytics-decision.json` with `status: instrument` — i.e. a user-facing change
in a project with a detected provider. Skip entirely when analytics is off or the change is not
user-facing.

## Inputs

- `project_root` — resolves the docs tree and the analytics decision sidecar.
- `module`, `feature` — the module and feature slugs the event belongs to (from the module map).
- `event` — the exact event name, in the project's ONE consistent convention.
- `provider` — one or more analytics provider ids the event fires to.

## Procedure

1. **Name the event** in the project's one consistent convention. Read
   `docs/instructions/stack/analytics.md` and the module's `analytics/index.md` first, and reuse
   an existing event before coining a new one. Object-action + past tense is a common default,
   not a rule; consistency is the rule, and no variable data goes in the name.
2. **Govern a new event.** If the event does not already exist, open a Decision Pause packet in
   the `analytics.new_event` category (who proposed it, why, with the name/casing/taxonomy/PII
   surfaced) via the `decision` skill and wait for the answer. Never add a new event silently.
3. **Instrument + document.** Run the bundled script to write the per-event doc and get the
   provider call snippet:
   `node scripts/instrument.mjs <project-root> --module <m> --feature <f> --event <name> --provider <p> [--provider <p> ...]`.
   Paste the printed snippet at the call site, then fill in the doc body — what the event means,
   its properties, and the PII/consent section.

## Output Contract

The script prints JSON `{ docPath, written, snippet }` on stdout: `docPath` is the module-owned
per-event doc, `written` lists the files created or refreshed (the doc + the per-module
`analytics/index.md`), and `snippet` is the provider tracking call(s) to paste. The doc's
existence is what the `off | warn | strict` completeness gate checks at Done.

## Escalate / Stop Conditions

- A brand-new event, or any name/casing/taxonomy/PII concern: STOP and open the
  `analytics.new_event` (or the matching `analytics.*`) Decision Pause; do not instrument until
  it resolves.
- Analytics off or a non-`instrument` sidecar: do nothing (INV-1 keeps a non-analytics run
  silent).

## Resources

- `scripts/instrument.mjs` — writes the per-event doc + index and prints the provider snippet.
- `references/analytics-tracking-plan-contract.md` — the tracking-plan-as-code contract this
  skill implements.
