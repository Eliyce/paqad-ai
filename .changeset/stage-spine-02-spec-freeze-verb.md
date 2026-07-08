---
'paqad-ai': minor
---

Ship `paqad-ai spec freeze` and activate the built-but-dead spec sign-off engine
(#317). The `src/spec/` freeze machinery (build → evaluate → freeze → write frozen
sidecar) was fully implemented and tested but had no caller and no instruction naming
it, so the "spec frozen and signed off before code" promise was enforced by nothing.
The new `spec freeze <spec-file>` verb wires the existing engine end to end: it prints
every freeze blocker and exits non-zero (nothing written) when the spec is not
freezable, and on a clean spec writes the frozen sidecar at `.paqad/specs/<id>.frozen.json`.
The specification-stage instructions and the feature-development rule now name the
command so the agent runs it. No freeze logic is reimplemented.
