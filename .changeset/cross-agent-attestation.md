---
'paqad-ai': minor
---

Become the neutral, cross-agent attestation authority (issue #120).

The #118 receipt now records change authorship: which onboarded adapter wrote the change (a known fact), the declared model/provider (env-supplied, graded `provenance: 'declared'` so a routed model is never mistaken for a verified one), and the human who accepted it (git identity, suppressible via `PAQAD_NO_HUMAN_ATTESTATION`). Because paqad's trust signal is gate-derived, the attestation vouches for the change regardless of which AI tool produced it. Field names mirror the cross-vendor `agent-trace` convention (`model_id` = `provider/model`) so the record interoperates with that ecosystem rather than competing with it. Authorship is folded into the signed VSA predicate, flattened into `paqad:authorship:*` AI-BOM properties, rendered as a one-line PR-comment footer, and summarised in the dashboard's new Attestation section. When no authorship resolves the field is omitted entirely, so prior receipts stay byte-identical.
