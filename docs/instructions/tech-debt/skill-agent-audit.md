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

As of 2026-11-01: 110 skills, 25 agents (rendered templates included) and 27 personas.

### By rule

| Rule | Blocking | Warnings |
| --- | --- | --- |
| AG-002 | 0 | 18 |
| AG-021 | 0 | 2 |
| AG-022 | 16 | 0 |
| SK-004 | 0 | 107 |

### By group

| Group | Items | Blocking | Warnings | Listing tokens | Description characters | Body tokens |
| --- | --- | --- | --- | --- | --- | --- |
| skills: base | 47 | 0 | 45 | 3234 | 12876 | 40480 |
| skills: coding | 29 | 0 | 29 | 1459 | 5788 | 16922 |
| skills: content | 6 | 0 | 6 | 301 | 1192 | 1639 |
| skills: plugin | 17 | 0 | 17 | 1384 | 6860 | 15422 |
| skills: security | 11 | 0 | 10 | 602 | 2396 | 7334 |
| agents: base | 1 | 0 | 2 | 59 | 0 | 684 |
| agents: plugin | 8 | 8 | 6 | 272 | 0 | 4523 |
| agents: templates | 16 | 8 | 12 | 544 | 0 | 9846 |

### Skills

<details>
<summary>skills: base (47, 0 blocking)</summary>

| Skill | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens before | after | drop | Rival (Jaccard 0.4 or more) | Script tests | Naming (later decision) | Open packet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/base/skills/acceptance-criteria-gen` | 0 | 1 | no activation data | 44 | 928 | 924 | 4 |  | tested | SK-004 |  |
| `runtime/base/skills/adversarial-review` | 0 | 1 | no activation data | 42 | 557 | 554 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/agent-orchestrator` | 0 | 1 | no activation data | 150 | 2072 | 2072 | 0 |  | no scripts | SK-004 |  |
| `runtime/base/skills/analytics-instrumentation` | 0 | 1 | no activation data | 103 | 733 | 731 | 2 |  | tested | SK-004 |  |
| `runtime/base/skills/api-doc-maintainer` | 0 | 1 | no activation data | 35 | 535 | 532 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/canonical-doc-sync` | 0 | 1 | no activation data | 47 | 475 | 473 | 2 |  | tested | SK-004 |  |
| `runtime/base/skills/context-budget-planner` | 0 | 1 | no activation data | 56 | 686 | 683 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/cross-module-impact-scanner` | 0 | 1 | no activation data | 61 | 811 | 808 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/decision` | 0 | 1 | no activation data | 71 | 849 | 833 | 16 |  | tested | SK-004 |  |
| `runtime/base/skills/diff-doc-sync` | 0 | 1 | no activation data | 43 | 467 | 464 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/diff-minimizer` | 0 | 1 | no activation data | 61 | 890 | 887 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/documentation-sync-engine` | 0 | 1 | no activation data | 57 | 759 | 757 | 2 |  | tested | SK-004 |  |
| `runtime/base/skills/documentation-workflow` | 0 | 1 | no activation data | 82 | 1021 | 1019 | 2 |  | tested | SK-004 |  |
| `runtime/base/skills/edge-case-detection` | 0 | 1 | no activation data | 47 | 492 | 490 | 2 |  | tested | SK-004 |  |
| `runtime/base/skills/error-catalog-maintainer` | 0 | 1 | no activation data | 39 | 544 | 542 | 2 |  | tested | SK-004 |  |
| `runtime/base/skills/existing-doc-checker` | 0 | 0 | no activation data | 48 | 442 | 439 | 3 |  | tested |  |  |
| `runtime/base/skills/expert-need-detector` | 0 | 1 | no activation data | 188 | 1112 | 1112 | 0 |  | no scripts | SK-004 |  |
| `runtime/base/skills/expert-notes` | 0 | 1 | no activation data | 206 | 1485 | 1485 | 0 |  | tested | SK-004 |  |
| `runtime/base/skills/expert-synthesis` | 0 | 1 | no activation data | 88 | 1366 | 1363 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/finding-normalizer` | 0 | 0 | no activation data | 42 | 693 | 689 | 4 |  | tested |  |  |
| `runtime/base/skills/glossary-maintainer` | 0 | 1 | no activation data | 38 | 466 | 463 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/integration-doc-maintainer` | 0 | 1 | no activation data | 46 | 593 | 591 | 2 |  | tested | SK-004 |  |
| `runtime/base/skills/module-attribution-extractor` | 0 | 1 | no activation data | 82 | 1283 | 1252 | 31 |  | tested | SK-004 |  |
| `runtime/base/skills/module-attribution-inferencer` | 0 | 1 | no activation data | 94 | 1593 | 1562 | 31 |  | tested | SK-004 |  |
| `runtime/base/skills/module-health-rollup` | 0 | 1 | no activation data | 92 | 1353 | 1328 | 25 |  | tested | SK-004 |  |
| `runtime/base/skills/module-health-update` | 0 | 1 | no activation data | 76 | 1418 | 1413 | 5 |  | tested | SK-004 |  |
| `runtime/base/skills/module-map-reconciler` | 0 | 1 | no activation data | 78 | 1716 | 1690 | 26 |  | tested | SK-004 |  |
| `runtime/base/skills/performance-regression-estimator` | 0 | 1 | no activation data | 61 | 796 | 793 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/request-classifier` | 0 | 1 | no activation data | 42 | 490 | 487 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/requirement-enrichment` | 0 | 1 | no activation data | 53 | 1082 | 1078 | 4 |  | tested | SK-004 |  |
| `runtime/base/skills/rollback-safety-planner` | 0 | 1 | no activation data | 59 | 762 | 759 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/rule-analyzer` | 0 | 1 | no activation data | 98 | 1142 | 1130 | 12 |  | tested | SK-004 |  |
| `runtime/base/skills/rule-editor` | 0 | 1 | no activation data | 81 | 889 | 879 | 10 |  | tested | SK-004 |  |
| `runtime/base/skills/rule-script-generator` | 0 | 1 | no activation data | 91 | 1163 | 1150 | 13 |  | tested | SK-004 |  |
| `runtime/base/skills/rule-script-reconciler` | 0 | 1 | no activation data | 76 | 908 | 893 | 15 |  | tested | SK-004 |  |
| `runtime/base/skills/rule-script-runner` | 0 | 1 | no activation data | 83 | 665 | 654 | 11 |  | tested | SK-004 |  |
| `runtime/base/skills/scope-check` | 0 | 1 | no activation data | 43 | 460 | 457 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/sequence-planner` | 0 | 1 | no activation data | 44 | 482 | 479 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/session-resume` | 0 | 1 | no activation data | 49 | 465 | 462 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/skill-orchestrator` | 0 | 1 | no activation data | 87 | 2010 | 2010 | 0 |  | no scripts | SK-004 |  |
| `runtime/base/skills/spec-diff` | 0 | 1 | no activation data | 50 | 440 | 438 | 2 |  | tested | SK-004 |  |
| `runtime/base/skills/spec-quality-review` | 0 | 1 | no activation data | 46 | 650 | 646 | 4 |  | tested | SK-004 |  |
| `runtime/base/skills/story-and-solution-writer` | 0 | 1 | no activation data | 45 | 483 | 481 | 2 |  | tested | SK-004 |  |
| `runtime/base/skills/test-execution-feedback-loop` | 0 | 1 | no activation data | 56 | 768 | 765 | 3 |  | tested | SK-004 |  |
| `runtime/base/skills/test-per-ac-planner` | 0 | 1 | no activation data | 44 | 617 | 615 | 2 |  | tested | SK-004 |  |
| `runtime/base/skills/test-runner-discovery` | 0 | 1 | no activation data | 66 | 828 | 783 | 45 |  | no scripts | SK-004 |  |
| `runtime/base/skills/workflow-router` | 0 | 1 | no activation data | 44 | 368 | 365 | 3 |  | tested | SK-004 |  |

</details>

<details>
<summary>skills: coding (29, 0 blocking)</summary>

| Skill | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens before | after | drop | Rival (Jaccard 0.4 or more) | Script tests | Naming (later decision) | Open packet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/capabilities/coding/skills/accessibility-review` | 0 | 1 | no activation data | 57 | 758 | 752 | 6 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/component-conformance-review` | 0 | 1 | no activation data | 59 | 764 | 760 | 4 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/copy-and-ia-review` | 0 | 1 | no activation data | 32 | 682 | 680 | 2 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/database-design-review` | 0 | 1 | no activation data | 47 | 535 | 532 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/design-system-coverage` | 0 | 1 | no activation data | 52 | 850 | 846 | 4 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/design-system-sync` | 0 | 1 | no activation data | 32 | 819 | 815 | 4 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/guard-inference` | 0 | 1 | no activation data | 65 | 521 | 518 | 3 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/index-optimization` | 0 | 1 | no activation data | 43 | 521 | 519 | 2 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/journey-synthesis` | 0 | 1 | no activation data | 61 | 561 | 557 | 4 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/map-verification` | 0 | 1 | no activation data | 59 | 509 | 506 | 3 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/motion-review` | 0 | 1 | no activation data | 36 | 576 | 575 | 1 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/query-pattern-analysis` | 0 | 1 | no activation data | 54 | 497 | 495 | 2 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/responsive-review` | 0 | 1 | no activation data | 34 | 614 | 612 | 2 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/root-cause-analysis` | 0 | 1 | no activation data | 48 | 443 | 441 | 2 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/site-map-assembly` | 0 | 1 | no activation data | 66 | 467 | 464 | 3 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/site-map-gap-analysis` | 0 | 1 | no activation data | 51 | 504 | 501 | 3 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/site-map-maintainer` | 0 | 1 | no activation data | 56 | 510 | 506 | 4 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/site-map-readiness` | 0 | 1 | no activation data | 46 | 504 | 502 | 2 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/site-map-retest` | 0 | 1 | no activation data | 65 | 520 | 517 | 3 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/state-coverage-review` | 0 | 1 | no activation data | 62 | 740 | 736 | 4 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/surface-extraction` | 0 | 1 | no activation data | 53 | 515 | 512 | 3 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/surface-modeling` | 0 | 1 | no activation data | 52 | 521 | 518 | 3 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/token-conformance-review` | 0 | 1 | no activation data | 53 | 1190 | 1185 | 5 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/transition-tracing` | 0 | 1 | no activation data | 55 | 497 | 494 | 3 |  | no scripts | SK-004 |  |
| `runtime/capabilities/coding/skills/ui-doc-maintainer` | 0 | 1 | no activation data | 45 | 473 | 470 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/user-flow-generation` | 0 | 1 | no activation data | 45 | 456 | 453 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/ux-design-research` | 0 | 1 | no activation data | 43 | 529 | 527 | 2 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/ux-heuristic-evaluation` | 0 | 1 | no activation data | 41 | 466 | 463 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/coding/skills/ux-state-machine` | 0 | 1 | no activation data | 47 | 469 | 466 | 3 |  | tested | SK-004 |  |

</details>

<details>
<summary>skills: content (6, 0 blocking)</summary>

| Skill | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens before | after | drop | Rival (Jaccard 0.4 or more) | Script tests | Naming (later decision) | Open packet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/capabilities/content/skills/content-planner` | 0 | 1 | no activation data | 45 | 248 | 245 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/content/skills/content-reviewer` | 0 | 1 | no activation data | 46 | 306 | 303 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/content/skills/content-writer` | 0 | 1 | no activation data | 55 | 314 | 311 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/content/skills/script-writer` | 0 | 1 | no activation data | 47 | 260 | 258 | 2 |  | tested | SK-004 |  |
| `runtime/capabilities/content/skills/seo-optimizer` | 0 | 1 | no activation data | 55 | 257 | 255 | 2 |  | tested | SK-004 |  |
| `runtime/capabilities/content/skills/style-enforcer` | 0 | 1 | no activation data | 53 | 270 | 267 | 3 |  | tested | SK-004 |  |

</details>

<details>
<summary>skills: plugin (17, 0 blocking)</summary>

| Skill | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens before | after | drop | Rival (Jaccard 0.4 or more) | Script tests | Naming (later decision) | Open packet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/claude-plugin/skills/ask` | 0 | 1 | no activation data | 246 | 1743 | 1585 | 158 |  | tested | SK-004 |  |
| `runtime/claude-plugin/skills/check-tickets` | 0 | 1 | no activation data | 45 | 906 | 795 | 111 | write-tickets (0.43) | tested | SK-004 |  |
| `runtime/claude-plugin/skills/dashboard` | 0 | 1 | no activation data | 52 | 213 | 213 | 0 |  | no scripts | SK-004 |  |
| `runtime/claude-plugin/skills/decide-together` | 0 | 1 | no activation data | 42 | 767 | 767 | 0 | get-connected (0.43) | no scripts | SK-004 |  |
| `runtime/claude-plugin/skills/discover` | 0 | 1 | no activation data | 165 | 1448 | 1236 | 212 |  | tested | SK-004 |  |
| `runtime/claude-plugin/skills/get-connected` | 0 | 1 | no activation data | 44 | 1000 | 871 | 129 | decide-together (0.43) | tested | SK-004 |  |
| `runtime/claude-plugin/skills/ground-in-project` | 0 | 1 | no activation data | 48 | 1406 | 1246 | 160 |  | tested | SK-004 |  |
| `runtime/claude-plugin/skills/join` | 0 | 1 | no activation data | 62 | 230 | 230 | 0 |  | no scripts | SK-004 |  |
| `runtime/claude-plugin/skills/onboard` | 0 | 1 | no activation data | 65 | 396 | 395 | 1 |  | no scripts | SK-004 |  |
| `runtime/claude-plugin/skills/plan-sprint` | 0 | 1 | no activation data | 220 | 1183 | 1183 | 0 |  | tested | SK-004 |  |
| `runtime/claude-plugin/skills/post-tickets` | 0 | 1 | no activation data | 45 | 1440 | 1439 | 1 | get-connected (0.41) | tested | SK-004 |  |
| `runtime/claude-plugin/skills/refine-ticket` | 0 | 1 | no activation data | 205 | 1568 | 1435 | 133 |  | tested | SK-004 |  |
| `runtime/claude-plugin/skills/shape-idea` | 0 | 1 | no activation data | 42 | 1129 | 912 | 217 |  | no scripts | SK-004 |  |
| `runtime/claude-plugin/skills/size-work` | 0 | 1 | no activation data | 193 | 1255 | 1110 | 145 |  | tested | SK-004 |  |
| `runtime/claude-plugin/skills/start` | 0 | 1 | no activation data | 160 | 484 | 484 | 0 |  | no scripts | SK-004 |  |
| `runtime/claude-plugin/skills/understand-idea` | 0 | 1 | no activation data | 45 | 638 | 518 | 120 |  | no scripts | SK-004 |  |
| `runtime/claude-plugin/skills/write-tickets` | 0 | 1 | no activation data | 44 | 1088 | 1003 | 85 | check-tickets (0.43) | no scripts | SK-004 |  |

</details>

<details>
<summary>skills: security (11, 0 blocking)</summary>

| Skill | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens before | after | drop | Rival (Jaccard 0.4 or more) | Script tests | Naming (later decision) | Open packet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/capabilities/security/skills/auth-mechanism-review` | 0 | 1 | no activation data | 70 | 969 | 965 | 4 |  | tested | SK-004 |  |
| `runtime/capabilities/security/skills/business-logic-abuse-review` | 0 | 1 | no activation data | 56 | 493 | 490 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/security/skills/cryptographic-review` | 0 | 1 | no activation data | 64 | 940 | 935 | 5 |  | tested | SK-004 |  |
| `runtime/capabilities/security/skills/dependency-advisory-triage` | 0 | 1 | no activation data | 47 | 435 | 432 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/security/skills/input-validation-review` | 0 | 1 | no activation data | 62 | 876 | 872 | 4 |  | tested | SK-004 |  |
| `runtime/capabilities/security/skills/logging-monitoring-review` | 0 | 0 | no activation data | 67 | 934 | 930 | 4 |  | tested |  |  |
| `runtime/capabilities/security/skills/permission-boundary-review` | 0 | 1 | no activation data | 48 | 473 | 470 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/security/skills/rate-limiting-review` | 0 | 1 | no activation data | 68 | 734 | 731 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/security/skills/retest-verification` | 0 | 1 | no activation data | 37 | 461 | 458 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/security/skills/runtime-surface-probing` | 0 | 1 | no activation data | 40 | 439 | 436 | 3 |  | tested | SK-004 |  |
| `runtime/capabilities/security/skills/stride-threat-model` | 0 | 1 | no activation data | 43 | 618 | 615 | 3 |  | tested | SK-004 |  |

</details>

### Agents

<details>
<summary>agents: base (1, 0 blocking)</summary>

| Agent | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens before | after | drop | Rival (Jaccard 0.4 or more) | Naming (later decision) | Open packet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/base/agents/agent-orchestrator.md` | 0 | 2 | 0 | 59 | 684 | 684 | 0 |  |  |  |

</details>

<details>
<summary>agents: plugin (8, 8 blocking)</summary>

| Agent | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens before | after | drop | Rival (Jaccard 0.4 or more) | Naming (later decision) | Open packet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/claude-plugin/agents/paqad-checks.md` | 1 | 1 | 0 | 32 | 532 | 528 | 4 |  | AG-002 |  |
| `runtime/claude-plugin/agents/paqad-chief-architect.md` | 1 | 0 | 2 | 39 | 438 | 559 | -121 |  |  |  |
| `runtime/claude-plugin/agents/paqad-development.md` | 1 | 1 | 7 | 33 | 547 | 552 | -5 |  | AG-002 |  |
| `runtime/claude-plugin/agents/paqad-documentation-sync.md` | 1 | 1 | 0 | 37 | 624 | 609 | 15 |  | AG-002 |  |
| `runtime/claude-plugin/agents/paqad-expert.md` | 1 | 0 | 18 | 33 | 475 | 589 | -114 |  |  |  |
| `runtime/claude-plugin/agents/paqad-planning.md` | 1 | 1 | 2 | 28 | 510 | 507 | 3 |  | AG-002 |  |
| `runtime/claude-plugin/agents/paqad-review.md` | 1 | 1 | 0 | 32 | 644 | 635 | 9 |  | AG-002 |  |
| `runtime/claude-plugin/agents/paqad-specification.md` | 1 | 1 | 4 | 38 | 545 | 544 | 1 |  | AG-002 |  |

</details>

<details>
<summary>agents: templates (16, 8 blocking)</summary>

| Agent | Blocking | Warnings | Fired (30 days) | Listing tokens | Body tokens before | after | drop | Rival (Jaccard 0.4 or more) | Naming (later decision) | Open packet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-checks` | 1 | 1 | 0 | 32 | 532 | 528 | 4 |  | AG-002 |  |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-chief-architect` | 1 | 0 | 2 | 39 | 438 | 559 | -121 |  |  |  |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-development` | 1 | 1 | 7 | 33 | 547 | 552 | -5 |  | AG-002 |  |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-documentation-sync` | 1 | 1 | 0 | 37 | 624 | 609 | 15 |  | AG-002 |  |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-expert` | 1 | 0 | 18 | 33 | 475 | 589 | -114 |  |  |  |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-planning` | 1 | 1 | 2 | 28 | 510 | 507 | 3 |  | AG-002 |  |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-review` | 1 | 1 | 0 | 32 | 644 | 635 | 9 |  | AG-002 |  |
| `runtime/templates/stage-agents/claude.md.hbs#paqad-specification` | 1 | 1 | 4 | 38 | 545 | 544 | 1 |  | AG-002 |  |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-checks` | 0 | 1 | 0 | 32 | 597 | 662 | -65 |  | AG-002 |  |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-chief-architect` | 0 | 0 | 2 | 39 | 438 | 559 | -121 |  |  |  |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-development` | 0 | 1 | 7 | 33 | 612 | 685 | -73 |  | AG-002 |  |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-documentation-sync` | 0 | 1 | 0 | 37 | 689 | 742 | -53 |  | AG-002 |  |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-expert` | 0 | 0 | 18 | 33 | 475 | 589 | -114 |  |  |  |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-planning` | 0 | 1 | 2 | 28 | 575 | 640 | -65 |  | AG-002 |  |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-review` | 0 | 1 | 0 | 32 | 709 | 769 | -60 |  | AG-002 |  |
| `runtime/templates/stage-agents/codex.toml.hbs#paqad-specification` | 0 | 1 | 4 | 38 | 610 | 677 | -67 |  | AG-002 |  |

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

### Skill listing

Skills that start only from their command (`disable-model-invocation: true`) leave the listing: dashboard, join, onboard, start.

| Listing tokens with them | Listing tokens without them | Saving |
| --- | --- | --- |
| 7319 | 6980 | 339 |
