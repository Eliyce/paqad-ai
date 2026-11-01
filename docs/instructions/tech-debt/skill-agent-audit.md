# Skill and agent audit

paqad lints its own skills and agents with `paqad-ai skill lint --all` and `paqad-ai agent lint --all`.
`paqad-ai skill audit` renders this page from both reports. The Before section is written once and
kept as it is; a later run rewrites only the After section. Naming warnings (SK-004, AG-002) stay
warnings: no skill or agent is renamed in this audit.

## Before

As of 2026-11-01: 110 skills, 33 agents (rendered templates included) and 27 personas.

### By rule

| Rule | Blocking | Warnings |
| --- | --- | --- |
| AG-002 | 0 | 24 |
| AG-007 | 32 | 0 |
| AG-008 | 32 | 0 |
| AG-013 | 78 | 0 |
| AG-017 | 240 | 0 |
| AG-021 | 0 | 2 |
| AG-022 | 24 | 0 |
| SK-004 | 0 | 107 |
| SK-005 | 84 | 0 |
| SK-009 | 37 | 0 |
| SK-010 | 246 | 0 |
| SK-011 | 3 | 0 |
| SK-012 | 6 | 0 |
| SK-013 | 3 | 0 |
| SK-014 | 7 | 0 |
| SK-015 | 4 | 0 |
| SK-016 | 833 | 0 |
| SK-017 | 1 | 0 |
| SK-018 | 2 | 0 |

### By group

| Group | Items | Blocking | Warnings | Listing tokens | Description characters | Body tokens |
| --- | --- | --- | --- | --- | --- | --- |
| skills: base | 47 | 594 | 45 | 3196 | 12717 | 40807 |
| skills: coding | 29 | 324 | 29 | 956 | 3777 | 17011 |
| skills: content | 6 | 57 | 6 | 283 | 1117 | 1655 |
| skills: plugin | 17 | 107 | 17 | 2391 | 9545 | 16894 |
| skills: security | 11 | 144 | 10 | 324 | 1274 | 7372 |
| agents: .claude/agents | 8 | 102 | 6 | 189 | 0 | 4392 |
| agents: base | 1 | 0 | 2 | 59 | 0 | 684 |
| agents: plugin | 8 | 102 | 6 | 189 | 0 | 4315 |
| agents: templates | 16 | 202 | 12 | 378 | 0 | 9020 |

### Skills

<details>
<summary>skills: base (47, 594 blocking)</summary>

| Skill | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens | Rival (Jaccard 0.4 or more) | Script tests | Naming (later decision) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/base/skills/acceptance-criteria-gen` | 9 | 1 | no activation data | 15 | 928 |  | 3 SK-010 | SK-004 |
| `runtime/base/skills/adversarial-review` | 9 | 1 | no activation data | 17 | 557 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/agent-orchestrator` | 0 | 1 | no activation data | 150 | 2072 |  | no scripts | SK-004 |
| `runtime/base/skills/analytics-instrumentation` | 14 | 1 | no activation data | 177 | 733 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/api-doc-maintainer` | 7 | 1 | no activation data | 16 | 535 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/canonical-doc-sync` | 8 | 1 | no activation data | 18 | 475 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/context-budget-planner` | 11 | 1 | no activation data | 36 | 686 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/cross-module-impact-scanner` | 21 | 1 | no activation data | 36 | 811 |  | 3 SK-010 | SK-004 |
| `runtime/base/skills/decision` | 17 | 1 | no activation data | 170 | 849 |  | 3 SK-010 | SK-004 |
| `runtime/base/skills/diff-doc-sync` | 5 | 1 | no activation data | 16 | 467 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/diff-minimizer` | 9 | 1 | no activation data | 35 | 890 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/documentation-sync-engine` | 12 | 1 | no activation data | 35 | 759 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/documentation-workflow` | 15 | 1 | no activation data | 63 | 1021 |  | 3 SK-010 | SK-004 |
| `runtime/base/skills/edge-case-detection` | 2 | 1 | no activation data | 14 | 492 |  | 1 SK-010 | SK-004 |
| `runtime/base/skills/error-catalog-maintainer` | 6 | 1 | no activation data | 9 | 544 |  | 3 SK-010 | SK-004 |
| `runtime/base/skills/existing-doc-checker` | 8 | 0 | no activation data | 18 | 442 |  | 2 SK-010 |  |
| `runtime/base/skills/expert-need-detector` | 0 | 1 | no activation data | 188 | 1112 |  | no scripts | SK-004 |
| `runtime/base/skills/expert-notes` | 0 | 1 | no activation data | 206 | 1485 |  | tested | SK-004 |
| `runtime/base/skills/expert-synthesis` | 14 | 1 | no activation data | 144 | 1366 |  | 1 SK-010 | SK-004 |
| `runtime/base/skills/finding-normalizer` | 9 | 0 | no activation data | 19 | 693 |  | 1 SK-010 |  |
| `runtime/base/skills/glossary-maintainer` | 7 | 1 | no activation data | 14 | 466 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/integration-doc-maintainer` | 7 | 1 | no activation data | 12 | 593 |  | 3 SK-010 | SK-004 |
| `runtime/base/skills/module-attribution-extractor` | 44 | 1 | no activation data | 88 | 1283 |  | 3 SK-010 | SK-004 |
| `runtime/base/skills/module-attribution-inferencer` | 34 | 1 | no activation data | 94 | 1593 |  | 3 SK-010 | SK-004 |
| `runtime/base/skills/module-health-rollup` | 26 | 1 | no activation data | 157 | 1353 |  | 4 SK-010 | SK-004 |
| `runtime/base/skills/module-health-update` | 32 | 1 | no activation data | 173 | 1418 |  | 5 SK-010 | SK-004 |
| `runtime/base/skills/module-map-reconciler` | 37 | 1 | no activation data | 103 | 1716 |  | 5 SK-010 | SK-004 |
| `runtime/base/skills/performance-regression-estimator` | 24 | 1 | no activation data | 34 | 796 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/request-classifier` | 5 | 1 | no activation data | 15 | 490 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/requirement-enrichment` | 13 | 1 | no activation data | 23 | 1082 |  | 1 SK-010 | SK-004 |
| `runtime/base/skills/rollback-safety-planner` | 12 | 1 | no activation data | 34 | 762 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/rule-analyzer` | 22 | 1 | no activation data | 164 | 1142 |  | 4 SK-010 | SK-004 |
| `runtime/base/skills/rule-editor` | 22 | 1 | no activation data | 148 | 889 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/rule-script-generator` | 25 | 1 | no activation data | 158 | 1163 |  | 4 SK-010 | SK-004 |
| `runtime/base/skills/rule-script-reconciler` | 16 | 1 | no activation data | 126 | 908 |  | 1 SK-010 | SK-004 |
| `runtime/base/skills/rule-script-runner` | 13 | 1 | no activation data | 116 | 665 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/scope-check` | 8 | 1 | no activation data | 17 | 460 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/sequence-planner` | 7 | 1 | no activation data | 11 | 482 |  | 1 SK-010 | SK-004 |
| `runtime/base/skills/session-resume` | 7 | 1 | no activation data | 18 | 465 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/skill-orchestrator` | 0 | 1 | no activation data | 87 | 2010 |  | no scripts | SK-004 |
| `runtime/base/skills/spec-diff` | 6 | 1 | no activation data | 20 | 440 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/spec-quality-review` | 11 | 1 | no activation data | 18 | 650 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/story-and-solution-writer` | 4 | 1 | no activation data | 13 | 483 |  | 1 SK-010 | SK-004 |
| `runtime/base/skills/test-execution-feedback-loop` | 17 | 1 | no activation data | 32 | 768 |  | 2 SK-010 | SK-004 |
| `runtime/base/skills/test-per-ac-planner` | 5 | 1 | no activation data | 15 | 617 |  | 3 SK-010 | SK-004 |
| `runtime/base/skills/test-runner-discovery` | 10 | 1 | no activation data | 103 | 828 |  | no scripts | SK-004 |
| `runtime/base/skills/workflow-router` | 4 | 1 | no activation data | 21 | 368 |  | 2 SK-010 | SK-004 |

</details>

<details>
<summary>skills: coding (29, 324 blocking)</summary>

| Skill | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens | Rival (Jaccard 0.4 or more) | Script tests | Naming (later decision) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/capabilities/coding/skills/accessibility-review` | 36 | 1 | no activation data | 41 | 758 |  | 4 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/component-conformance-review` | 22 | 1 | no activation data | 44 | 764 |  | 4 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/copy-and-ia-review` | 21 | 1 | no activation data | 20 | 682 |  | 4 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/database-design-review` | 3 | 1 | no activation data | 16 | 535 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/design-system-coverage` | 37 | 1 | no activation data | 43 | 850 |  | 5 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/design-system-sync` | 13 | 1 | no activation data | 32 | 819 |  | 5 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/guard-inference` | 5 | 1 | no activation data | 52 | 521 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/index-optimization` | 5 | 1 | no activation data | 15 | 521 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/journey-synthesis` | 12 | 1 | no activation data | 50 | 561 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/map-verification` | 7 | 1 | no activation data | 49 | 509 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/motion-review` | 13 | 1 | no activation data | 21 | 576 |  | 4 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/query-pattern-analysis` | 4 | 1 | no activation data | 15 | 497 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/responsive-review` | 15 | 1 | no activation data | 34 | 614 |  | 4 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/root-cause-analysis` | 7 | 1 | no activation data | 16 | 443 |  | 1 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/site-map-assembly` | 8 | 1 | no activation data | 49 | 467 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/site-map-gap-analysis` | 5 | 1 | no activation data | 43 | 504 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/site-map-maintainer` | 6 | 1 | no activation data | 47 | 510 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/site-map-readiness` | 6 | 1 | no activation data | 43 | 504 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/site-map-retest` | 9 | 1 | no activation data | 44 | 520 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/state-coverage-review` | 22 | 1 | no activation data | 41 | 740 |  | 4 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/surface-extraction` | 6 | 1 | no activation data | 42 | 515 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/surface-modeling` | 4 | 1 | no activation data | 43 | 521 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/token-conformance-review` | 27 | 1 | no activation data | 38 | 1190 |  | 5 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/transition-tracing` | 6 | 1 | no activation data | 45 | 497 |  | no scripts | SK-004 |
| `runtime/capabilities/coding/skills/ui-doc-maintainer` | 7 | 1 | no activation data | 17 | 473 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/user-flow-generation` | 3 | 1 | no activation data | 14 | 456 |  | 1 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/ux-design-research` | 6 | 1 | no activation data | 14 | 529 |  | 1 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/ux-heuristic-evaluation` | 5 | 1 | no activation data | 13 | 466 |  | 1 SK-010 | SK-004 |
| `runtime/capabilities/coding/skills/ux-state-machine` | 4 | 1 | no activation data | 15 | 469 |  | 1 SK-010 | SK-004 |

</details>

<details>
<summary>skills: content (6, 57 blocking)</summary>

| Skill | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens | Rival (Jaccard 0.4 or more) | Script tests | Naming (later decision) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/capabilities/content/skills/content-planner` | 14 | 1 | no activation data | 45 | 248 |  | 1 SK-010 | SK-004 |
| `runtime/capabilities/content/skills/content-reviewer` | 12 | 1 | no activation data | 46 | 306 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/content/skills/content-writer` | 6 | 1 | no activation data | 55 | 314 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/content/skills/script-writer` | 6 | 1 | no activation data | 47 | 260 |  | 1 SK-010 | SK-004 |
| `runtime/capabilities/content/skills/seo-optimizer` | 13 | 1 | no activation data | 50 | 257 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/content/skills/style-enforcer` | 6 | 1 | no activation data | 40 | 270 |  | 1 SK-010 | SK-004 |

</details>

<details>
<summary>skills: plugin (17, 107 blocking)</summary>

| Skill | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens | Rival (Jaccard 0.4 or more) | Script tests | Naming (later decision) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/claude-plugin/skills/ask` | 13 | 1 | no activation data | 246 | 1743 |  | 6 SK-010 | SK-004 |
| `runtime/claude-plugin/skills/check-tickets` | 10 | 1 | no activation data | 113 | 906 |  | 6 SK-010 | SK-004 |
| `runtime/claude-plugin/skills/dashboard` | 0 | 1 | no activation data | 52 | 213 |  | no scripts | SK-004 |
| `runtime/claude-plugin/skills/decide-together` | 0 | 1 | no activation data | 117 | 767 |  | no scripts | SK-004 |
| `runtime/claude-plugin/skills/discover` | 8 | 1 | no activation data | 165 | 1448 |  | 6 SK-010 | SK-004 |
| `runtime/claude-plugin/skills/get-connected` | 4 | 1 | no activation data | 139 | 1000 |  | 2 SK-010 | SK-004 |
| `runtime/claude-plugin/skills/ground-in-project` | 10 | 1 | no activation data | 113 | 1406 |  | 6 SK-010 | SK-004 |
| `runtime/claude-plugin/skills/join` | 0 | 1 | no activation data | 62 | 230 |  | no scripts | SK-004 |
| `runtime/claude-plugin/skills/onboard` | 1 | 1 | no activation data | 65 | 396 |  | no scripts | SK-004 |
| `runtime/claude-plugin/skills/plan-sprint` | 11 | 1 | no activation data | 220 | 1183 |  | 11 SK-010 | SK-004 |
| `runtime/claude-plugin/skills/post-tickets` | 9 | 1 | no activation data | 151 | 1440 |  | 8 SK-010 | SK-004 |
| `runtime/claude-plugin/skills/refine-ticket` | 19 | 1 | no activation data | 205 | 1568 |  | 12 SK-010 | SK-004 |
| `runtime/claude-plugin/skills/shape-idea` | 3 | 1 | no activation data | 127 | 1129 |  | no scripts | SK-004 |
| `runtime/claude-plugin/skills/size-work` | 12 | 1 | no activation data | 193 | 1255 |  | 8 SK-010 | SK-004 |
| `runtime/claude-plugin/skills/start` | 0 | 1 | no activation data | 160 | 484 |  | no scripts | SK-004 |
| `runtime/claude-plugin/skills/understand-idea` | 2 | 1 | no activation data | 119 | 638 |  | no scripts | SK-004 |
| `runtime/claude-plugin/skills/write-tickets` | 5 | 1 | no activation data | 144 | 1088 |  | no scripts | SK-004 |

</details>

<details>
<summary>skills: security (11, 144 blocking)</summary>

| Skill | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens | Rival (Jaccard 0.4 or more) | Script tests | Naming (later decision) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/capabilities/security/skills/auth-mechanism-review` | 13 | 1 | no activation data | 45 | 969 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/security/skills/business-logic-abuse-review` | 9 | 1 | no activation data | 23 | 493 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/security/skills/cryptographic-review` | 24 | 1 | no activation data | 42 | 940 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/security/skills/dependency-advisory-triage` | 11 | 1 | no activation data | 18 | 435 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/security/skills/input-validation-review` | 17 | 1 | no activation data | 35 | 876 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/security/skills/logging-monitoring-review` | 16 | 0 | no activation data | 37 | 934 |  | 2 SK-010 |  |
| `runtime/capabilities/security/skills/permission-boundary-review` | 13 | 1 | no activation data | 18 | 473 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/security/skills/rate-limiting-review` | 14 | 1 | no activation data | 38 | 734 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/security/skills/retest-verification` | 5 | 1 | no activation data | 16 | 461 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/security/skills/runtime-surface-probing` | 12 | 1 | no activation data | 20 | 439 |  | 2 SK-010 | SK-004 |
| `runtime/capabilities/security/skills/stride-threat-model` | 10 | 1 | no activation data | 32 | 618 |  | 2 SK-010 | SK-004 |

</details>

### Agents

<details>
<summary>agents: .claude/agents (8, 102 blocking)</summary>

| Agent | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens | Rival (Jaccard 0.4 or more) | Naming (later decision) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `.claude/agents/paqad-checks.md` | 16 | 1 | 0 | 21 | 541 | paqad-development (0.86) | AG-002 |
| `.claude/agents/paqad-chief-architect.md` | 3 | 0 | 2 | 29 | 447 |  |  |
| `.claude/agents/paqad-development.md` | 16 | 1 | 1 | 22 | 556 | paqad-checks (0.86) | AG-002 |
| `.claude/agents/paqad-documentation-sync.md` | 16 | 1 | 0 | 24 | 634 | paqad-development (0.75) | AG-002 |
| `.claude/agents/paqad-expert.md` | 3 | 0 | 18 | 27 | 485 |  |  |
| `.claude/agents/paqad-planning.md` | 16 | 1 | 2 | 22 | 520 | paqad-development (0.86) | AG-002 |
| `.claude/agents/paqad-review.md` | 16 | 1 | 0 | 21 | 654 | paqad-development (0.86) | AG-002 |
| `.claude/agents/paqad-specification.md` | 16 | 1 | 4 | 23 | 555 | paqad-development (0.86) | AG-002 |

</details>

<details>
<summary>agents: base (1, 0 blocking)</summary>

| Agent | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens | Rival (Jaccard 0.4 or more) | Naming (later decision) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/base/agents/agent-orchestrator.md` | 0 | 2 | 0 | 59 | 684 |  |  |

</details>

<details>
<summary>agents: plugin (8, 102 blocking)</summary>

| Agent | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens | Rival (Jaccard 0.4 or more) | Naming (later decision) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/claude-plugin/agents/paqad-checks.md` | 16 | 1 | 0 | 21 | 532 | paqad-development (0.86) | AG-002 |
| `runtime/claude-plugin/agents/paqad-chief-architect.md` | 3 | 0 | 2 | 29 | 438 |  |  |
| `runtime/claude-plugin/agents/paqad-development.md` | 16 | 1 | 1 | 22 | 547 | paqad-checks (0.86) | AG-002 |
| `runtime/claude-plugin/agents/paqad-documentation-sync.md` | 16 | 1 | 0 | 24 | 624 | paqad-development (0.75) | AG-002 |
| `runtime/claude-plugin/agents/paqad-expert.md` | 3 | 0 | 18 | 27 | 475 |  |  |
| `runtime/claude-plugin/agents/paqad-planning.md` | 16 | 1 | 2 | 22 | 510 | paqad-development (0.86) | AG-002 |
| `runtime/claude-plugin/agents/paqad-review.md` | 16 | 1 | 0 | 21 | 644 | paqad-development (0.86) | AG-002 |
| `runtime/claude-plugin/agents/paqad-specification.md` | 16 | 1 | 4 | 23 | 545 | paqad-development (0.86) | AG-002 |

</details>

<details>
<summary>agents: templates (16, 202 blocking)</summary>

| Agent | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens | Rival (Jaccard 0.4 or more) | Naming (later decision) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-checks` | 16 | 1 | 0 | 21 | 532 | paqad-development (0.86) | AG-002 |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-chief-architect` | 3 | 0 | 2 | 29 | 438 |  |  |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-development` | 16 | 1 | 1 | 22 | 547 | paqad-checks (0.86) | AG-002 |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-documentation-sync` | 16 | 1 | 0 | 24 | 624 | paqad-development (0.75) | AG-002 |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-expert` | 3 | 0 | 18 | 27 | 475 |  |  |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-planning` | 16 | 1 | 2 | 22 | 510 | paqad-development (0.86) | AG-002 |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-review` | 16 | 1 | 0 | 21 | 644 | paqad-development (0.86) | AG-002 |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-specification` | 16 | 1 | 4 | 23 | 545 | paqad-development (0.86) | AG-002 |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-checks` | 16 | 1 | 0 | 21 | 597 | paqad-development (0.86) | AG-002 |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-chief-architect` | 2 | 0 | 2 | 29 | 438 |  |  |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-development` | 16 | 1 | 1 | 22 | 612 | paqad-checks (0.86) | AG-002 |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-documentation-sync` | 16 | 1 | 0 | 24 | 689 | paqad-development (0.75) | AG-002 |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-expert` | 2 | 0 | 18 | 27 | 475 |  |  |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-planning` | 16 | 1 | 2 | 22 | 575 | paqad-development (0.86) | AG-002 |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-review` | 16 | 1 | 0 | 21 | 709 | paqad-development (0.86) | AG-002 |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-specification` | 16 | 1 | 4 | 23 | 610 | paqad-development (0.86) | AG-002 |

</details>

### Personas

Persona files have no frontmatter, so no host loads them as a subagent. They are listed here and never block.

| Persona | Group | Tokens |
| --- | --- | --- |
| `runtime/base/agents/adversarial-reviewer.md` | base | 2026 |
| `runtime/base/agents/context-curator.md` | base | 852 |
| `runtime/base/agents/final-reviewer.md` | base | 1165 |
| `runtime/base/agents/gap-detector.md` | base | 1368 |
| `runtime/base/agents/market-researcher.md` | base | 769 |
| `runtime/base/agents/product-owner.md` | base | 680 |
| `runtime/base/agents/requirement-analyst.md` | base | 1734 |
| `runtime/base/agents/router.md` | base | 481 |
| `runtime/base/agents/skill-orchestrator.md` | base | 674 |
| `runtime/base/agents/story-designer.md` | base | 1546 |
| `runtime/base/agents/test-planner.md` | base | 1023 |
| `runtime/base/agents/verifier.md` | base | 1511 |
| `runtime/capabilities/coding/agents/app-cartographer.md` | coding | 867 |
| `runtime/capabilities/coding/agents/application-architect.md` | coding | 695 |
| `runtime/capabilities/coding/agents/chief-architect.md` | coding | 696 |
| `runtime/capabilities/coding/agents/data-modeler.md` | coding | 1534 |
| `runtime/capabilities/coding/agents/database-expert.md` | coding | 1417 |
| `runtime/capabilities/coding/agents/devops-engineer.md` | coding | 1259 |
| `runtime/capabilities/coding/agents/doc-maintainer.md` | coding | 1173 |
| `runtime/capabilities/coding/agents/integration-architect.md` | coding | 1580 |
| `runtime/capabilities/coding/agents/journey-designer.md` | coding | 736 |
| `runtime/capabilities/coding/agents/performance-analyst.md` | coding | 1740 |
| `runtime/capabilities/coding/agents/qa-engineer.md` | coding | 608 |
| `runtime/capabilities/coding/agents/solution-architect.md` | coding | 1238 |
| `runtime/capabilities/coding/agents/user-flow-writer.md` | coding | 577 |
| `runtime/capabilities/coding/agents/ux-ui-analyst.md` | coding | 1439 |
| `runtime/capabilities/security/agents/security-auditor.md` | security | 1523 |

<!-- audit-body-tokens {"runtime/base/skills/acceptance-criteria-gen":928,"runtime/base/skills/adversarial-review":557,"runtime/base/skills/agent-orchestrator":2072,"runtime/base/skills/analytics-instrumentation":733,"runtime/base/skills/api-doc-maintainer":535,"runtime/base/skills/canonical-doc-sync":475,"runtime/base/skills/context-budget-planner":686,"runtime/base/skills/cross-module-impact-scanner":811,"runtime/base/skills/decision":849,"runtime/base/skills/diff-doc-sync":467,"runtime/base/skills/diff-minimizer":890,"runtime/base/skills/documentation-sync-engine":759,"runtime/base/skills/documentation-workflow":1021,"runtime/base/skills/edge-case-detection":492,"runtime/base/skills/error-catalog-maintainer":544,"runtime/base/skills/existing-doc-checker":442,"runtime/base/skills/expert-need-detector":1112,"runtime/base/skills/expert-notes":1485,"runtime/base/skills/expert-synthesis":1366,"runtime/base/skills/finding-normalizer":693,"runtime/base/skills/glossary-maintainer":466,"runtime/base/skills/integration-doc-maintainer":593,"runtime/base/skills/module-attribution-extractor":1283,"runtime/base/skills/module-attribution-inferencer":1593,"runtime/base/skills/module-health-rollup":1353,"runtime/base/skills/module-health-update":1418,"runtime/base/skills/module-map-reconciler":1716,"runtime/base/skills/performance-regression-estimator":796,"runtime/base/skills/request-classifier":490,"runtime/base/skills/requirement-enrichment":1082,"runtime/base/skills/rollback-safety-planner":762,"runtime/base/skills/rule-analyzer":1142,"runtime/base/skills/rule-editor":889,"runtime/base/skills/rule-script-generator":1163,"runtime/base/skills/rule-script-reconciler":908,"runtime/base/skills/rule-script-runner":665,"runtime/base/skills/scope-check":460,"runtime/base/skills/sequence-planner":482,"runtime/base/skills/session-resume":465,"runtime/base/skills/skill-orchestrator":2010,"runtime/base/skills/spec-diff":440,"runtime/base/skills/spec-quality-review":650,"runtime/base/skills/story-and-solution-writer":483,"runtime/base/skills/test-execution-feedback-loop":768,"runtime/base/skills/test-per-ac-planner":617,"runtime/base/skills/test-runner-discovery":828,"runtime/base/skills/workflow-router":368,"runtime/capabilities/coding/skills/accessibility-review":758,"runtime/capabilities/coding/skills/component-conformance-review":764,"runtime/capabilities/coding/skills/copy-and-ia-review":682,"runtime/capabilities/coding/skills/database-design-review":535,"runtime/capabilities/coding/skills/design-system-coverage":850,"runtime/capabilities/coding/skills/design-system-sync":819,"runtime/capabilities/coding/skills/guard-inference":521,"runtime/capabilities/coding/skills/index-optimization":521,"runtime/capabilities/coding/skills/journey-synthesis":561,"runtime/capabilities/coding/skills/map-verification":509,"runtime/capabilities/coding/skills/motion-review":576,"runtime/capabilities/coding/skills/query-pattern-analysis":497,"runtime/capabilities/coding/skills/responsive-review":614,"runtime/capabilities/coding/skills/root-cause-analysis":443,"runtime/capabilities/coding/skills/site-map-assembly":467,"runtime/capabilities/coding/skills/site-map-gap-analysis":504,"runtime/capabilities/coding/skills/site-map-maintainer":510,"runtime/capabilities/coding/skills/site-map-readiness":504,"runtime/capabilities/coding/skills/site-map-retest":520,"runtime/capabilities/coding/skills/state-coverage-review":740,"runtime/capabilities/coding/skills/surface-extraction":515,"runtime/capabilities/coding/skills/surface-modeling":521,"runtime/capabilities/coding/skills/token-conformance-review":1190,"runtime/capabilities/coding/skills/transition-tracing":497,"runtime/capabilities/coding/skills/ui-doc-maintainer":473,"runtime/capabilities/coding/skills/user-flow-generation":456,"runtime/capabilities/coding/skills/ux-design-research":529,"runtime/capabilities/coding/skills/ux-heuristic-evaluation":466,"runtime/capabilities/coding/skills/ux-state-machine":469,"runtime/capabilities/content/skills/content-planner":248,"runtime/capabilities/content/skills/content-reviewer":306,"runtime/capabilities/content/skills/content-writer":314,"runtime/capabilities/content/skills/script-writer":260,"runtime/capabilities/content/skills/seo-optimizer":257,"runtime/capabilities/content/skills/style-enforcer":270,"runtime/capabilities/security/skills/auth-mechanism-review":969,"runtime/capabilities/security/skills/business-logic-abuse-review":493,"runtime/capabilities/security/skills/cryptographic-review":940,"runtime/capabilities/security/skills/dependency-advisory-triage":435,"runtime/capabilities/security/skills/input-validation-review":876,"runtime/capabilities/security/skills/logging-monitoring-review":934,"runtime/capabilities/security/skills/permission-boundary-review":473,"runtime/capabilities/security/skills/rate-limiting-review":734,"runtime/capabilities/security/skills/retest-verification":461,"runtime/capabilities/security/skills/runtime-surface-probing":439,"runtime/capabilities/security/skills/stride-threat-model":618,"runtime/claude-plugin/skills/ask":1743,"runtime/claude-plugin/skills/check-tickets":906,"runtime/claude-plugin/skills/dashboard":213,"runtime/claude-plugin/skills/decide-together":767,"runtime/claude-plugin/skills/discover":1448,"runtime/claude-plugin/skills/get-connected":1000,"runtime/claude-plugin/skills/ground-in-project":1406,"runtime/claude-plugin/skills/join":230,"runtime/claude-plugin/skills/onboard":396,"runtime/claude-plugin/skills/plan-sprint":1183,"runtime/claude-plugin/skills/post-tickets":1440,"runtime/claude-plugin/skills/refine-ticket":1568,"runtime/claude-plugin/skills/shape-idea":1129,"runtime/claude-plugin/skills/size-work":1255,"runtime/claude-plugin/skills/start":484,"runtime/claude-plugin/skills/understand-idea":638,"runtime/claude-plugin/skills/write-tickets":1088,".claude/agents/paqad-checks.md":541,".claude/agents/paqad-chief-architect.md":447,".claude/agents/paqad-development.md":556,".claude/agents/paqad-documentation-sync.md":634,".claude/agents/paqad-expert.md":485,".claude/agents/paqad-planning.md":520,".claude/agents/paqad-review.md":654,".claude/agents/paqad-specification.md":555,"runtime/base/agents/agent-orchestrator.md":684,"runtime/claude-plugin/agents/paqad-checks.md":532,"runtime/claude-plugin/agents/paqad-chief-architect.md":438,"runtime/claude-plugin/agents/paqad-development.md":547,"runtime/claude-plugin/agents/paqad-documentation-sync.md":624,"runtime/claude-plugin/agents/paqad-expert.md":475,"runtime/claude-plugin/agents/paqad-planning.md":510,"runtime/claude-plugin/agents/paqad-review.md":644,"runtime/claude-plugin/agents/paqad-specification.md":545,"runtime/templates/stage-agents/claude.md.hbs#paqad-checks":532,"runtime/templates/stage-agents/claude.md.hbs#paqad-chief-architect":438,"runtime/templates/stage-agents/claude.md.hbs#paqad-development":547,"runtime/templates/stage-agents/claude.md.hbs#paqad-documentation-sync":624,"runtime/templates/stage-agents/claude.md.hbs#paqad-expert":475,"runtime/templates/stage-agents/claude.md.hbs#paqad-planning":510,"runtime/templates/stage-agents/claude.md.hbs#paqad-review":644,"runtime/templates/stage-agents/claude.md.hbs#paqad-specification":545,"runtime/templates/stage-agents/codex.toml.hbs#paqad-checks":597,"runtime/templates/stage-agents/codex.toml.hbs#paqad-chief-architect":438,"runtime/templates/stage-agents/codex.toml.hbs#paqad-development":612,"runtime/templates/stage-agents/codex.toml.hbs#paqad-documentation-sync":689,"runtime/templates/stage-agents/codex.toml.hbs#paqad-expert":475,"runtime/templates/stage-agents/codex.toml.hbs#paqad-planning":575,"runtime/templates/stage-agents/codex.toml.hbs#paqad-review":709,"runtime/templates/stage-agents/codex.toml.hbs#paqad-specification":610,"runtime/base/agents/adversarial-reviewer.md":2026,"runtime/base/agents/context-curator.md":852,"runtime/base/agents/final-reviewer.md":1165,"runtime/base/agents/gap-detector.md":1368,"runtime/base/agents/market-researcher.md":769,"runtime/base/agents/product-owner.md":680,"runtime/base/agents/requirement-analyst.md":1734,"runtime/base/agents/router.md":481,"runtime/base/agents/skill-orchestrator.md":674,"runtime/base/agents/story-designer.md":1546,"runtime/base/agents/test-planner.md":1023,"runtime/base/agents/verifier.md":1511,"runtime/capabilities/coding/agents/app-cartographer.md":867,"runtime/capabilities/coding/agents/application-architect.md":695,"runtime/capabilities/coding/agents/chief-architect.md":696,"runtime/capabilities/coding/agents/data-modeler.md":1534,"runtime/capabilities/coding/agents/database-expert.md":1417,"runtime/capabilities/coding/agents/devops-engineer.md":1259,"runtime/capabilities/coding/agents/doc-maintainer.md":1173,"runtime/capabilities/coding/agents/integration-architect.md":1580,"runtime/capabilities/coding/agents/journey-designer.md":736,"runtime/capabilities/coding/agents/performance-analyst.md":1740,"runtime/capabilities/coding/agents/qa-engineer.md":608,"runtime/capabilities/coding/agents/solution-architect.md":1238,"runtime/capabilities/coding/agents/user-flow-writer.md":577,"runtime/capabilities/coding/agents/ux-ui-analyst.md":1439,"runtime/capabilities/security/agents/security-auditor.md":1523} -->

## After

Not generated yet. It is rewritten at the end of the change.
