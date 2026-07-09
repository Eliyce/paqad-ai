---
'paqad-ai': minor
---

Stage-Spine 11 (#326): truth tooling — `paqad-ai config effective` and a real `decision` CLI verb.

Two small commands that make the framework honest and self-explaining:

- **`paqad-ai config effective`** prints, per knob, the value that actually binds, the
  surface it came from (env → local `.paqad/.config` → tracked `configs/.config.*` →
  default), and the gate that consumes it. A knob shown `consumed by: NOTHING` is a
  placebo — a setting a team can change with no effect. The scan flags 12 verified
  placebos (the strictness/escalation/decision-threshold/research knobs). `rule_compliance`
  and `stages_mode` are shown through their real floored resolvers so the yaml-as-real-input
  truth (#319) is visible. Strictly read-only.
- **`paqad-ai decision create|resolve|list`** is a real, install-resolved CLI verb for the
  Decision Pause Contract, replacing the `node runtime/base/skills/decision/scripts/*.mjs`
  path the contract named — which ENOENTs in a real onboarded project (the scripts only
  exist in the dev repo). It wraps the existing engine (`createPendingDecision` /
  `resolvePendingDecision` — same ULID mint, same packet format, no fork), validates the
  category with a nearest-match suggestion, supports `--other "<text>"` write-ins on
  resolve, and lists pending/resolved packets. The generated Decision Pause Contract now
  names `npx paqad-ai decision …`.
