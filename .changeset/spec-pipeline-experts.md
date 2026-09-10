---
'paqad-ai': minor
---

feat(#547): wire the spec pipeline and ship the domain experts

The grounded prompt-to-spec pipeline and the expert plumbing were built but idle. This change
starts the pipeline from the specification stage, gives eleven domain experts and a chief
architect real behaviour, and records what every run costs and changes. It is off for onboarded
projects by default; both flags stay off unless a project opts in.

What is new when `spec_pipeline_enabled` is on:

- The specification stage runs the pipeline. A shared instruction in the policy and the router
  says so, a new `spec pipeline start` verb grounds and labels the request in one go, and a new
  `spec_pipeline_adoption` knob (warn or strict) controls how firmly a hand-written spec is
  refused at freeze.
- Eleven pickable experts and a chief architect become real through one `expert-notes` runner
  skill with a lens per expert and one `expert-synthesis` chief skill. The model decides which
  experts a request needs; the script only validates against the roster.
- Each expert writes short request-time notes; the chief accepts or declines them, recommends a
  resolution for each disagreement (which becomes a decision you make), and lists what nobody
  covered. The spec is crafted with every line traced to its source, and the craft gate refuses
  an untraced requirement or an accepted finding that never reached the spec.
- Freeze copies the run provenance into the record; the readable spec ends with a Provenance
  section; and every run records full metrics, with a `spec pipeline metrics` verb to read them
  back. A human's later edit to a frozen spec is captured by section.

With the flags off, feature-development is byte-identical to before.
