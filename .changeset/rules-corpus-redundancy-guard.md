---
'paqad-ai': patch
---

Stop shipping a duplicated environment rule and guard against it recurring (#94).

The `node-service` stack's "Environment Variable Management" rules restated the
typed-config, fail-fast, `.env.example`, and safe-default guidance that the
always-on `_shared/environment.md` rule already ships to the same project, so
onboarded node-service projects received the same guidance twice. That section
is collapsed to the one node-specific rule that sharpens the shared contract.

A new regression guard in `rule-quality.test.ts` compares every stack rule
against the always-on base, capability, and `_shared` rules that ship alongside
it and fails when a stack rule near-verbatim repeats one — a stack rule may
sharpen an always-on rule with stack-specific detail but must not duplicate it.
The contract is documented in `runtime/rules-authoring.md`.
