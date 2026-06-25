# How Paqad Works for Onboarded Projects

> **What this file is.** The canonical, plain-language map of what paqad-ai does
> *inside a project that has installed and onboarded it* (React, Go, C++, Python,
> any stack), from the moment an AI provider opens a session to the moment a
> change is verified and recorded. It is the single "start here" overview of the
> onboarded-project runtime.
>
> It deliberately **points to the code and the per-module docs instead of
> duplicating them**, so it stays small and the links stay authoritative. If you
> arrived here from a reference elsewhere: this is the framework's
> behaviour-in-an-onboarded-repo overview, not a spec for one module.
>
> **Audience.** Maintainers, and any AI agent working in this repo that needs the
> whole-system picture before touching a part.
>
> **Authority.** The single source of truth for module slugs and source paths is
> [`docs/instructions/rules/module-map.yml`](../instructions/rules/module-map.yml).
> Where this overview and the module-map disagree, the module-map wins.
>
> **Keep it current.** Governed by
> [`docs/instructions/rules/_shared/onboarded-overview-maintenance.md`](../instructions/rules/_shared/onboarded-overview-maintenance.md).
> When the stages, the skill/agent roster, or the consciousness engines change,
> update this file in the same change.

---

## 0. The one-sentence version

paqad-ai turns a generic AI coding assistant into one that **loads the project's
contract before it is allowed to edit, classifies and routes every request, runs
it through explicit stages, and refuses to call a change "done" until
language-agnostic verification gates pass** — so a change is made with knowledge
of the existing modules, docs, and tests, instead of in isolation.

Two product surfaces sit on top of one engine:

1. **cli-commands** — what a human runs in the terminal (`paqad-ai onboard`,
   `refresh`, `doctor`, `dashboard`, …). No LLM in the loop.
2. **agent-workflows** — what the AI does once it loads the entry file and follows
   the runtime rules, skills, and agent roles shipped in the package.

The rest of this document is about surface 2: the runtime an onboarded team's AI
provider actually executes.

---

## 1. The life of one request, end to end

A request travels through three arcs: **attach → route → execute-and-record.**

### 1a. Onboarding attaches the framework to the repo (one time)

`paqad-ai onboard` detects the stack from **lockfiles, not folder names**
(`package.json`, `go.mod`, `Gemfile`, …), so detection behaves the same in every
language ([`stack-detection-engine`](stack-detection-engine/index/summary.md),
`src/detection`). Onboarding then writes, deterministically and idempotently
([`src/onboarding/orchestrator.ts`](../../src/onboarding/orchestrator.ts)):

- **Thin per-provider entry files** — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
  `.cursor/rules/…`, `.github/copilot-instructions.md`, etc. Each is ~25 lines of
  prose that tells the AI to go load the framework; it is **not** the framework
  ([`adapter-onboarding`](adapter-onboarding/index/summary.md), `src/adapters`).
- **Provider config** — MCP server paths and lifecycle hooks (entry-gate,
  prompt-gate, session-start, completion) in each provider's native format.
- **Shared, language-neutral context** — `docs/instructions/rules` (project-owned,
  never clobbered), `docs/instructions/stack`, `docs/modules` scaffolds.
- **`.paqad/` metadata** — `framework-path.txt` (one pointer to the shared
  `~/.paqad-ai/current` install), `project-profile.yaml` (project facts only:
  stack + the project's own test/build/lint commands + active capabilities), the
  framework knobs in the git-ignored `.paqad/.config` (strictness, RAG, enterprise,
  escalation, features, model routing, …) with their defaults in
  `src/core/framework-config.ts` and a tracked `.paqad/.config.example` template,
  and the onboarding manifest
  ([`project-profile-schema`](project-profile-schema/index/summary.md)).

### 1b. Every session loads the contract before it can edit

When the provider opens a session it reads the entry file, resolves
`.paqad/framework-path.txt`, and loads the rules, stack, and design-system docs.
A **PreToolUse hook blocks every Edit / Write / NotebookEdit until** the AI has
done this and written the `.paqad/.agent-entry-loaded` sentinel; read-only tools
stay open so it can load first. Editing `CLAUDE.md` or anything under
`docs/instructions/` mid-session invalidates the sentinel and forces a reload.
This gate is what makes "code with the project's context" non-optional rather than
a hope pinned to a prompt. See [`CLAUDE.md`](../../CLAUDE.md) and
[`adapter-onboarding`](adapter-onboarding/index/summary.md).

### 1c. The request is classified and routed

The raw prompt is matched to a canonical workflow, then classified into routing
dimensions, then assigned a lane:

- **Classify** — [`workflow-router`](../../runtime/base/skills/workflow-router/SKILL.md)
  then [`request-classifier`](../../runtime/base/skills/request-classifier/SKILL.md)
  produce workflow, complexity, risk, scope, affected modules, output type, and
  target capability ([`src/pipeline/classifier.ts`](../../src/pipeline/classifier.ts)).
- **Route to a lane** — the [`Router`](../../runtime/base/agents/router.md) agent
  consults a deterministic `(workflow, complexity, risk) → lane` table:
  **fast** (minimal local phases), **graduated** (adds spec + review gates),
  **full** (everything, including migration and pentest).
  ([`agent-routing`](agent-routing/index/summary.md), `src/core/capabilities.ts`.)

Capabilities (`content` / `coding` / `security`) gate which skills and agents are
even available ([`capability-model`](capability-model/index/summary.md)). The
lane decides which stages run and how strict each is.

### 1d. Stages run, gates verify, evidence is recorded

The chosen lane is an ordered sequence of stages
([`workflow-engine`](workflow-engine/index/summary.md),
[`src/workflows/engine.ts`](../../src/workflows/engine.ts)). The canonical
feature-development stages are named in §2. Throughout:

- The **Decision Pause Contract** forces the AI to write a Decision Packet and
  stop for a human at flagged junctions (reuse-vs-create, architecture path, spec
  change, module-slug collision)
  ([`decision-pause-contract`](decision-pause-contract/index/summary.md)).
- **Verification gates** (16 of them) decide whether the change may land. They run
  transparently in-pipeline **and again at a git/CI backstop independent of the
  agent** ([`verification`](verification/index/summary.md), `src/verification`).
- Everything lands in the append-only **Evidence Ledger**, and a per-change
  provenance receipt is projected from it
  ([`evidence-ledger`](evidence-ledger/index/summary.md), `src/evidence`).

Runs checkpoint atomically and resume from the first incomplete step; cancellation
is cooperative ([`session-handoff`](session-handoff/index/summary.md)).

---

## 2. The feature-development stages

Customised by
[`docs/instructions/workflows/feature-development.yaml`](../instructions/workflows/feature-development.yaml);
the framework owns phase order and the mandatory safety stages.

| Stage | What happens | Skills / agents that fire |
| --- | --- | --- |
| **planning** | Read canonical docs first; confirm scope; attribute the change to a module | [`scope-check`](../../runtime/base/skills/scope-check/SKILL.md), [`requirement-enrichment`](../../runtime/base/skills/requirement-enrichment/SKILL.md), [`edge-case-detection`](../../runtime/base/skills/edge-case-detection/SKILL.md), the Attribution Gate ([`module-attribution-extractor`](../../runtime/base/skills/module-attribution-extractor/SKILL.md) → [`-inferencer`](../../runtime/base/skills/module-attribution-inferencer/SKILL.md)), [`module-map-reconciler`](../../runtime/base/skills/module-map-reconciler/SKILL.md), [`rule-script-reconciler`](../../runtime/base/skills/rule-script-reconciler/SKILL.md). Agents: [Requirement Analyst](../../runtime/base/agents/requirement-analyst.md), [solution-architect](../../runtime/capabilities/coding/agents/solution-architect.md), [data-modeler](../../runtime/capabilities/coding/agents/data-modeler.md) |
| **specification** | Freeze acceptance criteria and invariants before code (graduated/full need human sign-off) | [`acceptance-criteria-gen`](../../runtime/base/skills/acceptance-criteria-gen/SKILL.md), [`spec-diff`](../../runtime/base/skills/spec-diff/SKILL.md), [`spec-quality-review`](../../runtime/base/skills/spec-quality-review/SKILL.md), [`story-and-solution-writer`](../../runtime/base/skills/story-and-solution-writer/SKILL.md), [`sequence-planner`](../../runtime/base/skills/sequence-planner/SKILL.md), [`test-per-ac-planner`](../../runtime/base/skills/test-per-ac-planner/SKILL.md). Graduated/full add [`diff-minimizer`](../../runtime/base/skills/diff-minimizer/SKILL.md), [`cross-module-impact-scanner`](../../runtime/base/skills/cross-module-impact-scanner/SKILL.md), [`performance-regression-estimator`](../../runtime/base/skills/performance-regression-estimator/SKILL.md), [`rollback-safety-planner`](../../runtime/base/skills/rollback-safety-planner/SKILL.md). Agents: [Story Designer](../../runtime/base/agents/story-designer.md), [Test Planner](../../runtime/base/agents/test-planner.md), [Product Owner](../../runtime/base/agents/product-owner.md) |
| **development** | Write code under the [constitution](../instructions/rules/_shared/constitution.md): read module docs first, change only the requested scope, preserve user files, pair changes with tests, ask don't guess | Agents as relevant: [integration-architect](../../runtime/capabilities/coding/agents/integration-architect.md), [database-expert](../../runtime/capabilities/coding/agents/database-expert.md), [devops-engineer](../../runtime/capabilities/coding/agents/devops-engineer.md) |
| **review** | Gates first, then adversarial + gap passes, then final sign-off | [Verifier](../../runtime/base/agents/verifier.md), then [Adversarial Reviewer](../../runtime/base/agents/adversarial-reviewer.md) + [Gap Detector](../../runtime/base/agents/gap-detector.md) (+ [`adversarial-review`](../../runtime/base/skills/adversarial-review/SKILL.md), [security-auditor](../../runtime/capabilities/security/agents/security-auditor.md), [performance-analyst](../../runtime/capabilities/coding/agents/performance-analyst.md), [ux-ui-analyst](../../runtime/capabilities/coding/agents/ux-ui-analyst.md)), then [Final Reviewer](../../runtime/base/agents/final-reviewer.md). [`test-execution-feedback-loop`](../../runtime/base/skills/test-execution-feedback-loop/SKILL.md) proposes the smallest fix per failing test |
| **checks** | format → test → build in order, plus module-health and diff-scoped rule scripts | [`rule-script-runner`](../../runtime/base/skills/rule-script-runner/SKILL.md), [`module-health-rollup`](../../runtime/base/skills/module-health-rollup/SKILL.md) |
| **documentation_sync** | Sync only the docs the diff made stale | [`documentation-sync-engine`](../../runtime/base/skills/documentation-sync-engine/SKILL.md) routes to [`api-doc-maintainer`](../../runtime/base/skills/api-doc-maintainer/SKILL.md), [`integration-doc-maintainer`](../../runtime/base/skills/integration-doc-maintainer/SKILL.md), [`error-catalog-maintainer`](../../runtime/base/skills/error-catalog-maintainer/SKILL.md), [`canonical-doc-sync`](../../runtime/base/skills/canonical-doc-sync/SKILL.md), [`glossary-maintainer`](../../runtime/base/skills/glossary-maintainer/SKILL.md); [`diff-doc-sync`](../../runtime/base/skills/diff-doc-sync/SKILL.md) narrows the set |

---

## 3. Full catalog: every skill and agent, by lifecycle phase

This is the complete roster the framework ships into an onboarded repo: **39 base
skills, 18 coding skills, 11 security skills, 6 content skills, 20 agents.** Each
links to its definition; "knows" lists the existing-codebase signals it actually
consults. The authority for what exists remains
[`module-map.yml`](../instructions/rules/module-map.yml) and the runtime
directories.

### Classify / route
- [`workflow-router`](../../runtime/base/skills/workflow-router/SKILL.md) — match raw prompt to a canonical workflow. Knows: instructions.
- [`request-classifier`](../../runtime/base/skills/request-classifier/SKILL.md) — extract workflow/scope/impact/risk. Knows: instructions, module-map.
- [Router](../../runtime/base/agents/router.md) (agent) — pick fast/graduated/full lane deterministically. Knows: module-map, git.
- [Context Curator](../../runtime/base/agents/context-curator.md) (agent) — load only phase-relevant context within budget. Knows: docs/modules, source, module-map.
- [`session-resume`](../../runtime/base/skills/session-resume/SKILL.md) — rebuild compact session state after compaction. Knows: handoff metadata.
- [`context-budget-planner`](../../runtime/base/skills/context-budget-planner/SKILL.md) — estimate token footprint, recommend compaction. Knows: instructions, docs/modules.

### Requirements + spec
- [`scope-check`](../../runtime/base/skills/scope-check/SKILL.md) — is the request inside the approved spec boundary? Knows: docs/modules, instructions.
- [`requirement-enrichment`](../../runtime/base/skills/requirement-enrichment/SKILL.md) — expand thin requests across an operational checklist. Knows: docs/modules, instructions.
- [`acceptance-criteria-gen`](../../runtime/base/skills/acceptance-criteria-gen/SKILL.md) — testable Given/When/Then with stable AC ids. Knows: docs/modules, tests.
- [`spec-diff`](../../runtime/base/skills/spec-diff/SKILL.md) — covered / extension / conflict vs the active spec. Knows: docs/modules.
- [`spec-quality-review`](../../runtime/base/skills/spec-quality-review/SKILL.md) — find contradictions, gaps, TBD leaks in a spec. Knows: instructions.
- [`edge-case-detection`](../../runtime/base/skills/edge-case-detection/SKILL.md) — enumerate failure and uncommon paths. Knows: docs/modules.
- [Requirement Analyst](../../runtime/base/agents/requirement-analyst.md) (agent) — decompose into FR/NFR/AC/invariants. Knows: docs/modules, source, module-map.
- [Market Researcher](../../runtime/base/agents/market-researcher.md) (agent) — external benchmarks when needed. Knows: docs/modules, rag.

### Plan
- [`story-and-solution-writer`](../../runtime/base/skills/story-and-solution-writer/SKILL.md) — implementation-ready story + solution narrative. Knows: docs/modules, instructions.
- [`sequence-planner`](../../runtime/base/skills/sequence-planner/SKILL.md) — order work by global precedence (schema → contracts → … → UI). Knows: docs/modules, instructions.
- [`test-per-ac-planner`](../../runtime/base/skills/test-per-ac-planner/SKILL.md) — map each AC to the narrowest verification path. Knows: tests, docs/modules.
- [`diff-minimizer`](../../runtime/base/skills/diff-minimizer/SKILL.md) — drop scaffolding / over-build before coding. Knows: docs/modules, instructions.
- [`cross-module-impact-scanner`](../../runtime/base/skills/cross-module-impact-scanner/SKILL.md) — classify impact on consuming modules' surfaces. Knows: module-map, import-graph, docs/modules.
- [`rollback-safety-planner`](../../runtime/base/skills/rollback-safety-planner/SKILL.md) — executable rollback procedures for high-risk stories. Knows: instructions, docs/modules, git.
- [`performance-regression-estimator`](../../runtime/base/skills/performance-regression-estimator/SKILL.md) — pre-code perf hazards vs hot-path budgets. Knows: docs/modules, source.
- [Story Designer](../../runtime/base/agents/story-designer.md) (agent) — slice spec into dependency-ordered stories. Knows: docs/modules, source, tests, module-map.
- [Product Owner](../../runtime/base/agents/product-owner.md) (agent) — enforce scope, prevent gold-plating. Knows: docs/modules.
- [solution-architect](../../runtime/capabilities/coding/agents/solution-architect.md) (agent) — reuse map, patterns, contracts, trade-offs. Knows: docs/modules, source, git.
- [data-modeler](../../runtime/capabilities/coding/agents/data-modeler.md) (agent) — entities/relationships/migration plan. Knows: docs/modules, instructions.

### Implement
- [integration-architect](../../runtime/capabilities/coding/agents/integration-architect.md) (agent) — API/webhook/MCP boundaries, failure modes. Knows: source, docs/modules, module-map.
- [database-expert](../../runtime/capabilities/coding/agents/database-expert.md) (agent) — query perf, migration safety, integrity. Knows: source, docs/modules.
- [devops-engineer](../../runtime/capabilities/coding/agents/devops-engineer.md) (agent) — deployability, CI/CD, env parity. Knows: instructions, source.

### Review
- [`adversarial-review`](../../runtime/base/skills/adversarial-review/SKILL.md) — risk-first defect/coverage/assumption hunt. Knows: docs/modules, tests, source, git.
- [`test-execution-feedback-loop`](../../runtime/base/skills/test-execution-feedback-loop/SKILL.md) — smallest fix per failing test, anchored to file:line:AC. Knows: tests, source, git.
- [Adversarial Reviewer](../../runtime/base/agents/adversarial-reviewer.md) (agent) — challenge assumptions, find regressions, detect fix-loops. Knows: source, instructions, tests, git.
- [Gap Detector](../../runtime/base/agents/gap-detector.md) (agent) — missing reqs/edge cases/docs/orphans, cross-system impact. Knows: docs/modules, tests, source, traceability.
- [Final Reviewer](../../runtime/base/agents/final-reviewer.md) (agent) — confirm gates + spec + traceability, ready-for-handoff. Knows: tests, git, traceability.
- [security-auditor](../../runtime/capabilities/security/agents/security-auditor.md) (agent) — injection/auth/secrets/config scan on diff. Knows: source, docs/modules.
- [performance-analyst](../../runtime/capabilities/coding/agents/performance-analyst.md) (agent) — N+1, bloat, caching, async anti-patterns. Knows: source, docs/modules.
- [ux-ui-analyst](../../runtime/capabilities/coding/agents/ux-ui-analyst.md) (agent) — UI states, a11y, pattern consistency. Knows: docs/modules, instructions.

### Test / verify
- [Test Planner](../../runtime/base/agents/test-planner.md) (agent) — AC → test cases, stack-aware scaffolding. Knows: tests, source, docs/modules.
- [Verifier](../../runtime/base/agents/verifier.md) (agent) — ordered lint/type/test/build gates, evidence JSON, flaky quarantine. Knows: source, tests, git.

### Docs
- [`documentation-workflow`](../../runtime/base/skills/documentation-workflow/SKILL.md) — two-stage doc creation; builds module-map authority. Knows: docs/modules, module-map, traceability.
- [`documentation-sync-engine`](../../runtime/base/skills/documentation-sync-engine/SKILL.md) — route stale docs to domain maintainers. Knows: docs/modules, git.
- [`diff-doc-sync`](../../runtime/base/skills/diff-doc-sync/SKILL.md) — minimal set of docs stale from this diff. Knows: docs/modules, git.
- [`canonical-doc-sync`](../../runtime/base/skills/canonical-doc-sync/SKILL.md) — align specs/module docs/registries with shipped behaviour. Knows: docs/modules, source, git.
- [`existing-doc-checker`](../../runtime/base/skills/existing-doc-checker/SKILL.md) — scan canonical truth before writing new artifacts. Knows: docs/modules, module-map, traceability.
- [`api-doc-maintainer`](../../runtime/base/skills/api-doc-maintainer/SKILL.md) — routes/schemas/perms/errors together. Knows: docs/modules, source, git.
- [`integration-doc-maintainer`](../../runtime/base/skills/integration-doc-maintainer/SKILL.md) — events/jobs/contracts/fallbacks, both sides. Knows: docs/modules, source, git.
- [`error-catalog-maintainer`](../../runtime/base/skills/error-catalog-maintainer/SKILL.md) — error codes + recovery + registry consistency. Knows: docs/modules, source, git.
- [`glossary-maintainer`](../../runtime/base/skills/glossary-maintainer/SKILL.md) — shared terminology, drift detection. Knows: docs/modules, traceability.
- [doc-maintainer](../../runtime/capabilities/coding/agents/doc-maintainer.md) (agent) — detect drift, update only what changed. Knows: docs/modules, source, git.

### Module-map + health
- [`module-attribution-extractor`](../../runtime/base/skills/module-attribution-extractor/SKILL.md) — deterministic module refs from the prompt, collision detect. Knows: module-map, source.
- [`module-attribution-inferencer`](../../runtime/base/skills/module-attribution-inferencer/SKILL.md) — ranked hypothesis when the extractor finds nothing. Knows: module-map, source.
- [`module-map-reconciler`](../../runtime/base/skills/module-map-reconciler/SKILL.md) — drift between the map and the source tree. Knows: module-map, source, docs/modules.
- [`module-health-rollup`](../../runtime/base/skills/module-health-rollup/SKILL.md) — attribute coverage/tests to modules. Knows: module-map, tests, source.
- [`module-health-update`](../../runtime/base/skills/module-health-update/SKILL.md) — refresh the whole module graph in one pass. Knows: module-map, tests, source.

### Rules-as-scripts
- [`rule-analyzer`](../../runtime/base/skills/rule-analyzer/SKILL.md) — classify rules verifiable/heuristic/unverifiable. Knows: instructions, source.
- [`rule-editor`](../../runtime/base/skills/rule-editor/SKILL.md) — add/edit/remove/downgrade rules with stable ids. Knows: instructions.
- [`rule-script-generator`](../../runtime/base/skills/rule-script-generator/SKILL.md) — author `.mjs` checks validated against fixtures. Knows: instructions, source.
- [`rule-script-reconciler`](../../runtime/base/skills/rule-script-reconciler/SKILL.md) — detect rules-as-scripts drift. Knows: instructions, source.
- [`rule-script-runner`](../../runtime/base/skills/rule-script-runner/SKILL.md) — execute registered scripts diff-scoped in checks. Knows: instructions, source.

### Security (pentest workflow + review)
[`stride-threat-model`](../../runtime/capabilities/security/skills/stride-threat-model/SKILL.md),
[`business-logic-abuse-review`](../../runtime/capabilities/security/skills/business-logic-abuse-review/SKILL.md),
[`auth-mechanism-review`](../../runtime/capabilities/security/skills/auth-mechanism-review/SKILL.md),
[`input-validation-review`](../../runtime/capabilities/security/skills/input-validation-review/SKILL.md),
[`cryptographic-review`](../../runtime/capabilities/security/skills/cryptographic-review/SKILL.md),
[`permission-boundary-review`](../../runtime/capabilities/security/skills/permission-boundary-review/SKILL.md),
[`rate-limiting-review`](../../runtime/capabilities/security/skills/rate-limiting-review/SKILL.md),
[`logging-monitoring-review`](../../runtime/capabilities/security/skills/logging-monitoring-review/SKILL.md),
[`dependency-advisory-triage`](../../runtime/capabilities/security/skills/dependency-advisory-triage/SKILL.md),
[`runtime-surface-probing`](../../runtime/capabilities/security/skills/runtime-surface-probing/SKILL.md),
[`retest-verification`](../../runtime/capabilities/security/skills/retest-verification/SKILL.md),
plus the base skill [`finding-normalizer`](../../runtime/base/skills/finding-normalizer/SKILL.md)
and the [security-auditor](../../runtime/capabilities/security/agents/security-auditor.md) agent.
Backed by [`pentest-engine`](pentest-engine/index/summary.md). Knows: docs/modules, source, tests.

### UI / design (design-test workflow)
[`design-system-coverage`](../../runtime/capabilities/coding/skills/design-system-coverage/SKILL.md),
[`token-conformance-review`](../../runtime/capabilities/coding/skills/token-conformance-review/SKILL.md),
[`component-conformance-review`](../../runtime/capabilities/coding/skills/component-conformance-review/SKILL.md),
[`state-coverage-review`](../../runtime/capabilities/coding/skills/state-coverage-review/SKILL.md),
[`accessibility-review`](../../runtime/capabilities/coding/skills/accessibility-review/SKILL.md),
[`responsive-review`](../../runtime/capabilities/coding/skills/responsive-review/SKILL.md),
[`motion-review`](../../runtime/capabilities/coding/skills/motion-review/SKILL.md),
[`copy-and-ia-review`](../../runtime/capabilities/coding/skills/copy-and-ia-review/SKILL.md),
[`design-system-sync`](../../runtime/capabilities/coding/skills/design-system-sync/SKILL.md),
[`ui-doc-maintainer`](../../runtime/capabilities/coding/skills/ui-doc-maintainer/SKILL.md),
[`user-flow-generation`](../../runtime/capabilities/coding/skills/user-flow-generation/SKILL.md),
[`ux-state-machine`](../../runtime/capabilities/coding/skills/ux-state-machine/SKILL.md),
[`ux-heuristic-evaluation`](../../runtime/capabilities/coding/skills/ux-heuristic-evaluation/SKILL.md),
[`ux-design-research`](../../runtime/capabilities/coding/skills/ux-design-research/SKILL.md).
Knows: design-system docs, source, tests.

### Data / incident
[`database-design-review`](../../runtime/capabilities/coding/skills/database-design-review/SKILL.md),
[`index-optimization`](../../runtime/capabilities/coding/skills/index-optimization/SKILL.md),
[`query-pattern-analysis`](../../runtime/capabilities/coding/skills/query-pattern-analysis/SKILL.md),
[`root-cause-analysis`](../../runtime/capabilities/coding/skills/root-cause-analysis/SKILL.md).
Knows: docs/modules, source, module-map.

### Content (content workflow)
[`content-planner`](../../runtime/capabilities/content/skills/content-planner/SKILL.md),
[`content-writer`](../../runtime/capabilities/content/skills/content-writer/SKILL.md),
[`content-reviewer`](../../runtime/capabilities/content/skills/content-reviewer/SKILL.md),
[`script-writer`](../../runtime/capabilities/content/skills/script-writer/SKILL.md),
[`seo-optimizer`](../../runtime/capabilities/content/skills/seo-optimizer/SKILL.md),
[`style-enforcer`](../../runtime/capabilities/content/skills/style-enforcer/SKILL.md).
Knows: instructions.

---

## 4. Where whole-codebase consciousness lives

This is the substrate that makes the AI aware of the project beyond the file it is
editing. For each engine: how strong it is today, and whether it is **wired into
the coding flow** or **sits to the side** (advisory, lane-gated, or opt-in).

| Engine | What it gives the AI | Strength | Wired in, or to the side |
| --- | --- | --- | --- |
| [Module-Map](module-map-engine/index/summary.md) (`src/module-map`) | Which business modules and files exist, and which module a change belongs to | Strong, **structural** (existence), not behavioural | **Wired in** — gates `planning`; attribution forces every change to declare its module |
| [Traceability](traceability-engine/index/summary.md) (`src/traceability`) | A reality-rebuilt promise ↔ code ↔ test map; orphans and untested promises via import-graph BFS | Strong as a map | Wraps the pipeline; feeds **gates + Final Reviewer** more than the implementer mid-edit. Fast lane only scans changed files |
| [`cross-module-impact-scanner`](../../runtime/base/skills/cross-module-impact-scanner/SKILL.md) | Classifies impact on consuming modules (breaking / silent-shift / additive) | Real consumer-graph reasoning | **Lane-gated** — only graduated/full, during specification. A fast-lane edit gets none of it |
| [RAG / context](hybrid-rag/index/summary.md) (`src/rag`, `src/context`) | Retrieval of the most relevant existing code within a token budget | Present | **Opt-in** at onboarding; augments retrieval, does not gate |
| [Gap Detector](../../runtime/base/agents/gap-detector.md) | Cross-system impact, missing edge cases, orphans | Moderate-to-strong | **Wired into review** — catches misses after the fact, not during writing |
| [Verification gates](verification/index/summary.md) (`src/verification`) | 16 contract-driven, language-agnostic land/block checks | Strong | **Wired in twice** — in-pipeline and at the git/CI backstop |
| [Decision Pause](decision-pause-contract/index/summary.md) | A hard stop for human judgment at flagged junctions | Strong control point | Wired in; depends on the AI honouring it plus the PreToolUse hook |
| [Evidence Ledger](evidence-ledger/index/summary.md) (`src/evidence`) | An append-only record of what every gate and engine produced | The connective tissue | Wired in; a record, not an enforcer |

**The honest summary.** The always-on consciousness is the entry-gate +
module-map/attribution + verification gates. The *richest* cross-module reasoning
(impact scanner, the full traceability universe scan, RAG) is **lane-gated or
opt-in**, so it is present but not guaranteed on every edit, and is most absent on
fast-lane changes.

---

## 5. Language-agnostic reality

**Genuinely language-neutral** (works for Go, C++, React alike): stack detection
(lockfile patterns), the entry-gate and hooks, classify/route, the module-map
reconciler and source-root discovery (glob-based), traceability (file paths +
import edges + structured metadata), the 16 verification gates, decision-pause,
the evidence ledger, and most reasoning skills (scope, sequencing, edge-cases,
STRIDE, abuse-cases, permission boundaries, accessibility, content, RCA).

**Quietly ecosystem-bound** (lean Node / SQL / web and need per-stack guidance
elsewhere): rules-as-scripts authoring (reads `tsconfig`/ESLint, emits Node
`.mjs`), module-health parsers (a fixed set of coverage/test formats),
`test-execution-feedback-loop`, several security and performance skills that read
language-specific source idioms, and the API/integration/error doc maintainers
that extract from language-specific patterns (though they write neutral docs).

The pattern: the orchestration, contracts, and structural awareness are
universal; the leaf-level "read this source idiom" steps are where ecosystem
assumptions live.

---

## 6. Where each concern lives (pointer table)

| Concern | Start here |
| --- | --- |
| Cross-adapter entry | [`adapter-onboarding`](adapter-onboarding/index/summary.md), [`CLAUDE.md`](../../CLAUDE.md), `.paqad/framework-path.txt` |
| Stack detection | [`stack-detection-engine`](stack-detection-engine/index/summary.md), `docs/instructions/stack/overview.md` |
| Routing + capabilities | [`agent-routing`](agent-routing/index/summary.md), [`capability-model`](capability-model/index/summary.md), `src/core/capabilities.ts` |
| Workflow execution | [`workflow-engine`](workflow-engine/index/summary.md), [`feature-development-workflow`](feature-development-workflow/index/summary.md) |
| Skill / agent loading | [`skill-runtime`](skill-runtime/index/summary.md), [`agent-runtime`](agent-runtime/index/summary.md) |
| Module authority | [`module-map.yml`](../instructions/rules/module-map.yml), [`module-map-engine`](module-map-engine/index/summary.md) |
| Whole-product impact | [`traceability-engine`](traceability-engine/index/summary.md), [`cross-module-impact-scanner`](../../runtime/base/skills/cross-module-impact-scanner/SKILL.md) |
| Targeted retrieval | [`context-intelligence`](context-intelligence/index/summary.md), [`hybrid-rag`](hybrid-rag/index/summary.md) |
| Pause for a human | [`decision-pause-contract`](decision-pause-contract/index/summary.md) |
| Land / block a change | [`verification`](verification/index/summary.md), [`quality-ratchet`](quality-ratchet/index/summary.md) |
| Proof + provenance | [`evidence-ledger`](evidence-ledger/index/summary.md) |
| Per-prompt mechanics | [`prompt-life-cycle.md`](prompt-life-cycle.md) (research note, deeper stage-by-stage detail) |

---

## 7. How to keep this accurate

This overview is intentionally thin: it is a map, not a copy. It goes stale when
the *shape* of the system changes, not when an implementation detail does. Update
it in the same change that:

- adds, removes, or renames a stage in
  [`feature-development.yaml`](../instructions/workflows/feature-development.yaml);
- adds, removes, or renames a skill under `runtime/**/skills/` or an agent under
  `runtime/**/agents/` (update §3);
- adds or changes a consciousness engine in §4 (module-map, traceability, impact
  scanner, RAG, gates, decision-pause, evidence);
- changes which capability gates a skill or agent.

The enforcing rule is
[`docs/instructions/rules/_shared/onboarded-overview-maintenance.md`](../instructions/rules/_shared/onboarded-overview-maintenance.md).
