---
name: analytics-instrumentation
description: When the `analytics_instrumentation` flag is on and the classify-time gate resolved to `instrument`, this skill wires a feature's analytics the tracking-plan-as-code way (issue #279). The LLM only names the event (following the project's one consistent convention) and writes the doc body; the bundled `instrument.mjs` script computes the normalized slug and the module-owned doc path, writes the per-event doc and refreshes the per-module index via the framework's doc-tree primitives, and prints the provider tracking-call snippet to paste into the source. A brand-new event is never added silently — it goes through the `analytics.new_event` Decision Pause first. Scales to N providers by data (one doc, a section per provider), not by code.
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

Use this skill only when analytics is enabled and the change is user-facing. It turns "add
tracking for this feature" into the governed, documented, drift-resistant flow paqad promises.

## When it runs

The classify-time gate writes `.paqad/planning/analytics-decision.json`. When its `status` is
`instrument`, the feature-development stages instruct you to instrument. For each user-facing
behavior this change adds:

1. **Name the event** in the project's ONE consistent convention (read
   `docs/instructions/stack/analytics.md` and the module's `analytics/index.md` first — reuse an
   existing event before coining a new one). Object-action + past tense is a common default, not
   a rule; consistency is the rule. No variable data in the name.
2. **Govern a new event.** If the event does not already exist, open a Decision Pause packet in
   the `analytics.new_event` category (who proposed it, why, with the name/casing/taxonomy/PII
   surfaced) via the `decision` skill and wait for the answer. Never add a new event silently.
3. **Instrument + document.** Run the bundled script to write the per-event doc and get the
   provider call snippet, then paste the snippet into the source and fill in the doc body (what
   the event means, its properties, and the PII/consent section).

## What the script does

`node scripts/instrument.mjs <project-root> --module <m> --feature <f> --event <name> --provider <p> [--provider <p> ...]`

- Computes the normalized slug and the module-owned path
  `docs/modules/{module}/analytics/{feature}/{event}.md` (casing variants collapse to one doc).
- Writes the per-event doc (a section per provider, the exact event string inside) and refreshes
  the per-module `analytics/index.md`, using the framework's own doc-tree primitives — you never
  hand-compute a path or a slug.
- Prints JSON `{ docPath, written, snippet }`; `snippet` is the provider tracking call to paste.

You then write the human prose in the doc body and place the snippet at the call site. The
doc's existence is what the `off | warn | strict` completeness gate checks at Done.

## Resources

- `scripts/instrument.mjs` — writes the per-event doc + index and prints the provider snippet.
