# Spec: Route every prompt to one of 9 workflows first (issue #336)

## Behaviour summary

As its first action on every user message, the agent picks exactly one of **9 routing outcomes** by intent, narrates the pick in the paqad voice, and only then loads what that outcome needs. Rules (text plus scripts) and the lane load and run only for `feature-development`. All 8 real outcomes use RAG when `rag_enabled`; `no-workflow` uses nothing. No entry file changes. Routing runs per-message and is stateful: switching pauses (does not reset), resuming continues at the saved stage.

The 9 outcomes: `feature-development`, `project-question`, `documentation-update`, `module-documentation`, `pentest`, `design-test`, `rules-analyze`, `root-cause-analysis`, `no-workflow`.

Design (locked): the routing brain is the model, guided by the always-loaded bootstrap; the Claude Code hook layer reinforces ordering, records the chosen outcome as evidence, and drives mechanical gating. Fold mechanism resolved via decision D-01KX3ER3BQW3RP6FBRYQK31RS8 to a reroute layer: a `resolveRoutedWorkflow()` normalizer collapses the 24-value `CLASSIFICATION_WORKFLOWS` union into the 9 outcomes; no union members are deleted. RAG prompt-time retrieval is prompt-seeded but runs in the existing detached (non-blocking) worker.

## Functional requirements

- **FR-1**: Routing picks exactly one of the 9 outcomes per user message and narrates the pick in the paqad voice.
- **FR-2**: A `resolveRoutedWorkflow()` normalizer maps every `ClassificationWorkflow` value (and null) to exactly one of the 9 outcomes; all code-change intents map to `feature-development`; small talk and non-code content intents map to `no-workflow`.
- **FR-3**: Rules (manifest plus text) reach the model only on the `feature-development` route; other outcomes load no rules.
- **FR-4**: Rule-scripts execute only on the `feature-development` route, at the checks stage; no other outcome triggers them.
- **FR-5**: The lane (fast, graduated, full) is chosen only for `feature-development`; other outcomes get no lane and show no lane line.
- **FR-6**: All 8 real outcomes use RAG retrieval when `rag_enabled`, scoped by outcome; `no-workflow` retrieves nothing; retrieval never blocks the prompt path.
- **FR-7**: The chosen outcome is recorded per-session as evidence, and a paused-workflow stack preserves each paused outcome's resume anchors (change key, lane, frozen-spec id).
- **FR-8**: The framework bootstrap states the route-first order, the rules-only-for-feature-development load rule, and the per-message pause and resume rule; no provider entry file is modified.

## Acceptance criteria

- **AC-1**: Given paqad is on and a plain question, when the prompt is sent, then the outcome is project-question and no rules load and no rule-scripts run (proof: automated).
- **AC-2**: Given a code-change request including fix or refactor phrasing, when sent, then the outcome is feature-development and rules load and a lane is picked and rule-scripts run at checks (proof: automated).
- **AC-3**: Given a prompt with a Jira or GitHub URL or ticket reference, when sent, then the content is read first and the outcome is chosen from that content (proof: manual).
- **AC-4**: Given an ambiguous prompt between two real outcomes, when sent, then the model asks the user and offers no-workflow (proof: manual).
- **AC-5**: Given a pentest or design-test or docs or RCA or rules-analyze request, when sent, then it routes correctly and uses RAG if enabled and loads no rules and runs no rule-scripts (proof: automated).
- **AC-6**: Given small talk, when sent, then nothing loads and no RAG runs and the model just replies (proof: automated).
- **AC-7**: Given this change, when the diff is reviewed, then no entry file is modified (proof: automated).
- **AC-8**: Given a routed outcome, when the seam runs, then the outcome is recorded as evidence the same way the lane is recorded today (proof: automated).
- **AC-9**: Given the change, when CI runs, then full CI is green including branch coverage at or above 95 percent and the Windows job (proof: automated).
- **AC-10**: Given an active feature-development change with recorded plan and spec, when the user asks a question mid-way, then the message routes to project-question and the feature-development plan and spec and lane and stage progress are not lost or reset (proof: automated).
- **AC-11**: Given a paused feature-development change, when the user says continue, then paqad resumes the same change at its recorded stage and reloads its rules and does not re-plan or re-freeze (proof: automated).
- **AC-12**: Given a new code request during a question detour, when sent, then paqad starts a new feature-development change rather than resuming the paused one, and an ambiguous resume asks (proof: automated).

## Invariants

- **INV-1**: The feature-development plan-and-spec-before-code gate is never weakened or removed, and the `isFeatureDevEdit` scope predicate is unchanged.
- **INV-2**: No `CLASSIFICATION_WORKFLOWS` union member is deleted; the fold is additive plus a normalizer only.
- **INV-3**: Rule-scripts execute only on the feature-development route.
- **INV-4**: RAG retrieval never blocks the prompt path, and rag-disabled or no-workflow emits nothing, byte-identical to today.
- **INV-5**: No entry file is modified; routing logic lives only in the framework bootstrap plus the hook and pipeline layer.
- **INV-6**: The session-context artifact remains the authoritative rule contract and keeps its fail-safe marker behavior; only when the rule slice is injected up front changes.
- **INV-7**: Branch coverage stays at or above 95 percent globally and 100 percent on `src/stage-evidence`.
