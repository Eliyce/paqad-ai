---
'paqad-ai': patch
---

Fix onboarding to emit the `enterprise` block in the generated `project-profile.yaml`, and remove the two never-wired feature flags.

- **Onboarding now writes the `enterprise` block** (`enabled`, `evidence_ledger`, `ai_bom`, `compliance_citations`, all `false`). The opt-in evidence-ledger switches from #187 were previously invisible in a freshly onboarded profile, so users had nothing to toggle. Defaults stay all-off: a normal user pays zero tokens and writes nothing under `.paqad/ledger/`.
- **Removed `features.supply_chain_governance` and `features.ai_governance`.** These were declared in the profile type and schema but read by no code path, and their names collided conceptually with the now-real `enterprise.*` governance switches. Dropped from the `ProjectFeatureFlags` type, the JSON schema, the onboarding default, and all test fixtures.

Not a runtime break: `readProjectProfile` tolerates extra keys, so existing on-disk profiles that still contain the two removed flags continue to load (the stale keys are ignored).
