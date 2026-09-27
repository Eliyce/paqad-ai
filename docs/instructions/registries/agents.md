<!-- managed by paqad-ai — generated from src/onboarding/agent-registry-writer.ts. Do not edit by hand. -->

# Agent roster

The 22 built-in specialist roles, one row per `AGENT_ROLES` entry. Standing experts sit
at every spec run; on-call experts are picked by the detector; the chair runs whenever any expert
fired; machinery roles are the pipeline's own build-time helpers. Generated so the roster, the
persona files, and the README table cannot drift (issue #558).

| Role | Tier | Budget | Persona | Lens |
| --- | --- | --- | --- | --- |
| context-curator | machinery | 6000 | runtime/base/agents/context-curator.md | n/a |
| solution-architect | on-call | 8000 | runtime/capabilities/coding/agents/solution-architect.md | runtime/base/skills/expert-notes/references/lenses/solution-architect.md |
| db-expert | on-call | 6000 | runtime/capabilities/coding/agents/database-expert.md | runtime/base/skills/expert-notes/references/lenses/db-expert.md |
| ux-ui-analyst | on-call | 5000 | runtime/capabilities/coding/agents/ux-ui-analyst.md | runtime/base/skills/expert-notes/references/lenses/ux-ui-analyst.md |
| product-owner | standing | 5000 | runtime/base/agents/product-owner.md | runtime/base/skills/expert-notes/references/lenses/product-owner.md |
| market-researcher | on-call | 5000 | runtime/base/agents/market-researcher.md | runtime/base/skills/expert-notes/references/lenses/market-researcher.md |
| implementer | machinery | 12000 | none yet | n/a |
| reviewer | machinery | 10000 | none yet | n/a |
| verifier | machinery | 4000 | runtime/base/agents/verifier.md | n/a |
| security-auditor | on-call | 8000 | runtime/capabilities/security/agents/security-auditor.md | runtime/base/skills/expert-notes/references/lenses/security-auditor.md |
| test-planner | machinery | 6000 | runtime/base/agents/test-planner.md | n/a |
| gap-detector | machinery | 7000 | runtime/base/agents/gap-detector.md | n/a |
| requirement-analyst | machinery | 6000 | runtime/base/agents/requirement-analyst.md | n/a |
| devops-engineer | on-call | 5000 | runtime/capabilities/coding/agents/devops-engineer.md | runtime/base/skills/expert-notes/references/lenses/devops-engineer.md |
| doc-maintainer | machinery | 4000 | runtime/capabilities/coding/agents/doc-maintainer.md | n/a |
| performance-analyst | on-call | 6000 | runtime/capabilities/coding/agents/performance-analyst.md | runtime/base/skills/expert-notes/references/lenses/performance-analyst.md |
| data-modeler | on-call | 6000 | runtime/capabilities/coding/agents/data-modeler.md | runtime/base/skills/expert-notes/references/lenses/data-modeler.md |
| integration-architect | on-call | 8000 | runtime/capabilities/coding/agents/integration-architect.md | runtime/base/skills/expert-notes/references/lenses/integration-architect.md |
| qa-engineer | standing | 6000 | runtime/capabilities/coding/agents/qa-engineer.md | runtime/base/skills/expert-notes/references/lenses/qa-engineer.md |
| user-flow-writer | standing | 5000 | runtime/capabilities/coding/agents/user-flow-writer.md | runtime/base/skills/expert-notes/references/lenses/user-flow-writer.md |
| chief-architect | chair | 10000 | runtime/capabilities/coding/agents/chief-architect.md | n/a |
| application-architect | standing | 8000 | runtime/capabilities/coding/agents/application-architect.md | runtime/base/skills/expert-notes/references/lenses/application-architect.md |

## Personas the roles reuse

6 persona files back no role id of their own; the roles above reuse them.

| Persona | File |
| --- | --- |
| router | runtime/base/agents/router.md |
| story-designer | runtime/base/agents/story-designer.md |
| final-reviewer | runtime/base/agents/final-reviewer.md |
| adversarial-reviewer | runtime/base/agents/adversarial-reviewer.md |
| app-cartographer | runtime/capabilities/coding/agents/app-cartographer.md |
| journey-designer | runtime/capabilities/coding/agents/journey-designer.md |
