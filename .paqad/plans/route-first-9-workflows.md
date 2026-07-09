# Plan — Route every prompt to one of 9 workflows first (issue #336)

Branch: `feat/route-first-9-workflows` · one PR · small commits · CI must stay green (≥95% branch, 100% on `src/stage-evidence/**`, Windows job).

Non-negotiable: **do not break the feature-development workflow or its stages.** Every change augments the existing stage-evidence / capability-gate machinery; nothing removes the plan+spec-before-code gate or the `isFeatureDevEdit` scope predicate.

## Locked design decisions
- **D1 (repo memory):** routing brain = the **model's first action**, guided by the always-loaded bootstrap. The Claude Code hook layer reinforces ordering, records evidence, and drives mechanical gating. Cross-provider by nature.
- **Decision D-01KX3ER3BQW3RP6FBRYQK31RS8 (this PR, resolved → `reroute`):** fold to 9 via a **reroute layer**, not hard deletion. Keep `CLASSIFICATION_WORKFLOWS` (24 values) + the 7 internal behavior/lane/budget/retrieval sets intact; add a `resolveRoutedWorkflow()` normalizer that collapses the fine-grained classification to exactly one of 9 routing **outcomes**. Only the routing outcome / evidence / state / RAG-scope / lane-gating collapse to 9.
- **RAG wiring (engineering call, non-blocking):** honor the RAG buildout's documented hard constraint "complement, never block." Prompt-time retrieval is **prompt-seeded but runs in the existing detached background worker** (SWR), never a synchronous embed on the prompt path. New: seed the query with prompt text, scope by routed workflow, and skip entirely for `no-workflow`.

## The 9 routing outcomes (new `RoutedWorkflow` enum)
`feature-development`, `project-question`, `documentation-update`, `module-documentation`, `pentest`, `design-test`, `rules-analyze`, `root-cause-analysis`, `no-workflow`. (`pentest-retest`/`design-retest`/`rules-generate` are backing sub-modes of their parent, not separate outcomes.)

## Mechanical gating reduces to a 3-way split
The deterministic hook layer only needs: **is it feature-development?** (→ rules + lane + rule-scripts + code-scope RAG) vs **a real non-code workflow?** (→ no rules, no lane, no rule-scripts, docs-scope RAG) vs **no-workflow?** (→ nothing, no RAG). Misrouting pentest↔project-question is mechanically harmless (both non-feature-dev). This is why the reroute normalizer + existing classifier suffice; precise naming is for the model's narration + the evidence record.

## Subsystem findings that shape the work
- **Bootstrap** = `src/onboarding/agent-bootstrap-writer.ts` → golden `runtime/AGENT-BOOTSTRAP.md` (`pnpm vitest run agent-bootstrap-writer -u`). Rules bullet at the "Load the project contract" step must move to feature-dev-only. Guard test `agent-bootstrap-writer.test.ts:49-63` will need updating. **No entry files change (AC-7).**
- **Rule manifest is composed upstream** into `.paqad/context/session-context.md` by `composeRuleContext`/`writeRuleContext` (`src/context/rule-context.ts`), run by the detached `paqad-ai rag refresh-context` worker; the seam (`context-seam.mjs buildInjection` → `emitContext`) injects the file wholesale. The lane line is a **separate** stdout write (`emitLane`), already outside `[paqad-context]`.
- **Lane seam** = `src/pipeline/prompt-lane.ts` `runPromptLaneSeam` → `RequestClassifier` + `PipelineRouter` → lane, stashed via `writePendingLane` at `.paqad/ledger/paqad.stage-evidence/<sessionId>/.pending-lane`.
- **Rule-scripts** run via `ruleScriptsCapability.evaluate` (`src/kernel/capability.ts:214`) on **both** pre-mutation and completion seams with **no workflow/stage guard** today — the gap to close for "feature-dev only".
- **Scope predicate** `isFeatureDevEdit` (`src/stage-evidence/scope.ts`) = exclude-list (`.paqad/**`, `docs/**`, `*.md` → not feature-dev). Stays.
- **RAG retrieval fully built**: `RagService.retrieveForEval(input, topN)` + consumer `gatherWorkingSetSlices` / `composeRetrievalSection` / `applyPrecisionFloor` / `scopeForWorkflow` in `src/context/retrieval-context.ts`. Deferred piece = prompt-driven query (F11/F14/F26). `scopeForWorkflow(null)` currently returns `'docs'`; must special-case no-workflow → nothing.
- Live session uses the **installed** hooks (`~/.paqad-ai/current` → global 1.49.0), not the repo tree — so repo hook edits can't brick this session; correctness is proven by the vitest suite.

## Commit sequence (each green on its own)
1. **docs/.paqad**: this plan + frozen spec + resolved decision packet. (gate-exempt scope)
2. **feat**: `src/pipeline/routed-workflow.ts` — `ROUTED_WORKFLOWS` + `resolveRoutedWorkflow(ClassificationWorkflow|null): RoutedWorkflow`. Pure, fully unit-tested.
3. **feat**: reconcile model-facing routing tables to the 9 (`routing-rules.txt`, `workflow-router/SKILL.md`, `runtime/base/agents/router.md`, `request-classifier` assets); additively add `design-test`/`design-retest`/`rules-analyze`/`rules-generate` to `CLASSIFICATION_WORKFLOWS` + the JSON-schema mirror; reconcile `workflow-router.ts` target set. Update keyed tests. **No union members removed.**
4. **feat**: `src/pipeline/workflow-state.ts` — per-session store (active + paused stack, resume anchors = changeKey + lane + specId), reusing `sessionLedgerDir`. Fully tested.
5. **feat**: route seam — extend `prompt-lane.ts` to classify → `resolveRoutedWorkflow` → write workflow-state (pause/resume/switch) → gate lane to feature-development only → narrate routed workflow. Update `router.ts`/tests as needed.
6. **feat**: gate `ruleScriptsCapability` to the feature-development route (read workflow-state; keep `isFeatureDevEdit` skip). No other workflow can trigger rule-scripts.
7. **feat**: stop pre-injecting the rule manifest — make artifact injection workflow-aware (rules section injected only on the feature-dev route; base-drift + retrieval always). Preserve #284 artifact-first + #316 fail-safe marker.
8. **feat**: wire prompt-time RAG — prompt-seeded, workflow-scoped retrieval in the detached worker; `no-workflow` → no retrieval. Behind `rag_enabled`. Clean grep fallback (empty section).
9. **fix**: sentinel/edit-gate — "loaded" no longer requires rules; feature-dev still gated on plan+spec-before-code; non-feature-dev never trips the gate. Mostly verification + targeted tests.
10. **feat**: bootstrap — step 0 "route first" + rules feature-dev-only + per-message/pause-resume rule; regenerate golden; update guard tests. Narration contract: add routing to the cadence.
11. **chore**: `.changeset/*.md` (`'paqad-ai': minor`).

Then: `pnpm run ci` green locally → push → open one PR → watch CI → fix red.

## AC coverage map
- AC-1/AC-6 (question/small-talk: no rules, no scripts, no/again RAG) → bootstrap step 0 + workflow-aware injection (#7) + rule-scripts gate (#6) + RAG no-workflow skip (#8).
- AC-2 (code change → feature-dev: rules + lane + scripts) → normalizer (#2) + route seam (#5) + rule-scripts gate (#6) + bootstrap (#10).
- AC-3 (URL/ticket read-first) → bootstrap step 0 instruction.
- AC-4 (ambiguous → ask, offer no-workflow) → bootstrap step 0 (AskUserQuestion).
- AC-5 (pentest/design-test/docs/RCA/rules-analyze: route, RAG, no rules/scripts) → normalizer + injection gate + RAG scope.
- AC-7 (no entry-file changes) → assert via `entry-file-minimal` tests; touch only `agent-bootstrap-writer.ts`.
- AC-8 (chosen workflow recorded as evidence like the lane) → workflow-state store written by the seam (#4/#5).
- AC-9 (CI ≥95%, Windows) → per-commit tests + `pnpm run ci`.
- AC-10/11/12 (per-message pause/resume/new-change) → workflow-state pause/resume + bootstrap rule (#4/#5/#10).

## Risks & mitigations
- **Break feature-dev gate** → never touch the plan+spec-before-code precondition or `isFeatureDevEdit`; add-only signals; run the stage-evidence suite (100% floor) every commit.
- **Coverage regressions** → new files fully tested; prefer editing coverage-excluded files (`router.ts`, `workflow-router.ts`) where logic must live but is hard to cover; keep `prompt-lane.ts`/`classifier.ts`/`capability.ts`/`retrieval-context.ts`/`rule-context.ts` covered.
- **Windows** → posix path normalization already in helpers; reuse `sessionLedgerDir`; no `:` in filenames.
- **#284/#316 regressions** → keep the rules artifact intact as the contract; only change WHERE/WHEN it is injected vs model-read.
