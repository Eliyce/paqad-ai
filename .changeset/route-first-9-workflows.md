---
'paqad-ai': minor
---

Route every prompt to one of 9 workflows first; load rules only for feature-development (#336).

As its first action on every message, the agent now picks exactly one of 9 routing
outcomes by intent (feature-development, project-question, documentation-update,
module-documentation, pentest, design-test, rules-analyze, root-cause-analysis, or no
workflow), narrates the pick, and only then loads what that outcome needs. Rules (text
and scripts) and the lane load and run only for feature-development; the other real
workflows use RAG when enabled but carry no rules, no lane, and no rule-scripts; "no
workflow" loads nothing.

- The framework bootstrap gains a route-first step and states the rules-only-for-feature-development load plus a per-message pause/resume rule (routing runs every message and never resets a paused change). No provider entry file changes.
- A new `resolveRoutedWorkflow` normalizer folds the fine-grained classification into the 9 outcomes (a reroute layer — no classification union members are removed, so lane/budget/retrieval behaviour is preserved).
- The prompt seam records the routed workflow in a per-session workflow-state (active plus a paused stack with resume anchors) and gates the lane to feature-development.
- Rule-scripts run only on the feature-development route; the detached context worker composes the rule slice only for feature-development, seeds retrieval with the prompt, and retrieves nothing for "no workflow".
