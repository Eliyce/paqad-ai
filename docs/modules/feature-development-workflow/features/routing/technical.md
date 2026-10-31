# Lane & Complexity Routing — Technical View

> Module: **Feature Development Workflow** (`feature-development-workflow`) · Layer: `agent-workflows` · Feature slug: `routing`

## Where it lives

| Piece | File |
|---|---|
| Deterministic prompt classifier | `src/pipeline/pre-classifier.ts` |
| Prompt route seam and notification detection | `src/pipeline/prompt-lane.ts` |
| Route correction verb | `src/cli/commands/route.ts` |
| Lane override verb | `src/cli/commands/lane.ts` |
| Per-session workflow state (active and paused) | `src/pipeline/workflow-state.ts` |
| "Did this session edit this turn" | `src/pipeline/session-ownership.ts` |
| Route override audit log | `src/pipeline/route-override-log.ts` |
| Lane and stage policy | `docs/instructions/workflows/feature-development.yaml`, `src/workflows` |

The agent routes by intent, following `AGENT-ROUTER.md`. The classifier only writes the hook's first guess. `paqad-ai route set` makes enforcement follow the agent's pick.

## The about-work signal

`isAboutWorkPrompt(requestText)` in `pre-classifier.ts` marks a prompt that talks about the work rather than asking to change code. It routes the prompt to `project-question`, ahead of the code-change tier.

- It never fires when the prompt names code: a source path or source-language file, a strong code verb (fix, implement, build, refactor, develop), or a code surface noun (page, endpoint, component, test, bug and so on). It reads the raw request, because paths and extensions are lost to normalization.
- It fires on a tracker noun (issue, ticket, PR, pull request, a draft, the rewrite) with a work verb, or on a soft work noun (report, plan, doc, research) with a tracker verb (post, file, link, recheck, confirm) or with a tracker target (GitHub, Jira, Linear) and a work verb.
- When the prompt also carries a code keyword such as "add", a tracker noun or target must be named, so a real code request is never routed away from feature development.
- A separate fallback routes a prompt with a tracker verb and no code to `project-question` when nothing else matched. It never outranks a code keyword.

## A stage named during an open change

`runPromptRouteSeam` in `prompt-lane.ts` keeps a prompt that names a feature-development stage on feature-development when this session has a change open, so "run documentation_sync" does not pause the change and route to `documentation-update`.

- It only overrides a generic route: `documentation-update`, `project-question` or `no-workflow` (`STAGE_NAME_OVERRIDABLE_ROUTES`). A specialist workflow such as pentest, design-test, codebase-health, discovery, site-map, rules-analyze, root-cause-analysis or module-documentation is a deliberate detour, so "run a security review" still pauses the change.

- The stage names come from `STAGE_ORDER` and match as whole words, in the underscore form (`documentation_sync`) or with a space (`documentation sync`).
- A change is open when the session's active route is feature-development, or its own session control points at a bundle that is not closed. The control is only read, never reconciled, so routing never adopts a bundle.
- The open change keeps its lane; no new lane is stashed. A paused change is resumed.
- With no open change the prompt routes as before, and an open change does not keep an unrelated question from detouring.
- The rule lives only in the seam. `pre-classifier.ts` stays stateless.

## Notifications and hand-backs

`isSystemNotificationPrompt` in `prompt-lane.ts` keeps text that is not the person's own input out of routing. A prompt counts as a notification when:

- it starts with one of the notification elements (such as `<task-notification>`), or
- the banner `[system notification - not user input]` is a line of its own and some line opens with a notification element, which catches a report that comes first, or
- it is a foreground subagent hand-back: a line opens an `<agent-message …>` element and a line opens with `[subagent hand-back]` (`SUBAGENT_HANDBACK_MARKERS`).

Each marker must open its own line. A human prompt that quotes one of them inline, or only one of them, still routes.

## Route correction

`paqad-ai route set <workflow>`:

1. Resolves the session from `--session`, then `SE_SESSION`, then `CLAUDE_SESSION_ID`.
2. Refuses to leave `feature-development` only when `editedDevelopmentThisTurn(root, session)` is true: this session wrote an agent-authored `development` row in an unclosed bundle at or after the turn's `turn_started_at`. It reads the session's own rows, never the shared git tree, so another session cannot block it. Rows recorded against a session id read from the shared cache file do not count. With no turn stamp, any owned `development` row counts.
3. When no session was named at all, skips the check, allows the correction and records `UNRESOLVED_SESSION_REASON` in the audit row.
4. Rewrites the active workflow-state entry. If the target sits in the paused stack, the most recent matching entry is resumed with its plan, spec and lane anchors and taken off the stack. Otherwise a fresh active entry is set and the paused stack is left alone. The mislabelled entry is replaced, never paused.
5. Updates `.session-route.json`, clears a stashed lane when the new route is not feature development, and appends an `agent-override` row to `.route-overrides.jsonl` in the session's stage-evidence ledger.

## Lanes

`paqad-ai lane set <fast|graduated|full>` writes the lane on the active change's `feature.json` through the monotonic ratchet: it can raise the lane, and a downgrade is refused and reported. A request at or above the current lane records `lane_source: manual`. The end-of-change checks read that recorded lane.

`updateFeatureRecord` is the only lane writer. Every ordinary lane patch goes through `higherLane`. The lane source is recorded on `feature.json` as `lane_source`: `classifier` for the routing guess, `manual` for `lane set`, `plan` after a plan-time resize. A record with no `lane_source` counts as manual.

- **The one lowering.** `writeFeaturePlan` calls `planLaneResize` (`src/feature-evidence/lane-resize.ts`), which passes the `resizeLaneFromPlan` patch. That branch lowers `full` to `graduated` only when `lane_source` is `classifier`, no `lane_resized` exists, and the change ledger has no `stage_start` for specification, development, checks or documentation_sync. The caller adds the plan facts: the distinct `steps[].files` number 8 or fewer, none is high-sensitivity under `resolveEffectiveLane`, the routing impact saved as `.pending-impact` is present and is not a schema change, data migration or breaking API change, and git shows no changed file outside `.paqad/` since the change's start point. It writes `lane: graduated`, `lane_source: plan` and a once-only `lane_resized { from, to, reason, files, at }`, and `plan compile` prints `**▸ paqad** · lane set to graduated from full: <reason>`. A refused resize never blocks the compile.
- **A classifier patch does not undo it.** A lane with `lane_source: plan` ignores classifier-sourced patches, such as the pending lane `stage start` re-reads. A manual `lane set full` still raises it and pins `manual`.
- **The forward-only raise.** On every `stage start` (before its row is written) and every later `plan compile`, `raiseLaneIfGrown` raises a plan-lowered lane back to `full` once when the change edits more than 8 files outside `.paqad/`, or an edited or planned path is high-sensitivity. It records `lane_raised`, keeps `lane_source: plan`, and prints `**▸ paqad** · lane raised to full from graduated: <reason>`. Stage isolation then applies only to stages that start at or after `lane_raised.at`.
- **The authoring raise.** `raiseLaneForAuthoring` (same file, `src/feature-evidence/lane-resize.ts`) raises a `fast` change to `graduated` once when its planned or edited files include a skill path (`isSkillPath` in `src/authoring/paths.ts`), whatever `lane_source` says. It runs at `plan compile` and at `stage start`, records `lane_raised_for_authoring {from, to, reason, path, at}` on `feature.json`, keeps `lane_source`, and prints `**▸ paqad** · lane raised to graduated from fast: the change creates or edits a skill (<path>), so the Skill Orchestrator sits at the High Table.` A graduated lane raised this way can still rise to full: `laneMayRise` accepts it as well as a plan-lowered lane. Nothing is raised while `skill_orchestrator_enabled=false`.

## Configuration

| Key | Env | Default | Effect |
| --- | --- | --- | --- |
| `stage_isolation_lanes` | `PAQAD_STAGE_ISOLATION_LANES` | `full` | Lanes on which each stage runs in its own stage helper on a subagent-capable host. Other lanes run every stage inline. |
| `spec_pipeline_experts_lanes` | `PAQAD_SPEC_PIPELINE_EXPERTS_LANES` | `full` | Lanes on which the standing experts sit at every spec. Other lanes seat only the detector's picks, plus security-auditor for a sensitive planned path. |

Both are comma lists parsed by `resolveLaneList`: unknown names are dropped, an empty or unreadable value gives the default, and `full` is always included. The value in force when a check runs applies. Set both to `graduated,full` to restore the old behaviour.

## Why the `src/pipeline/` code works the way it does

The reasons below are not obvious from the code.

- **`pre-classifier.ts`.** The named workflows (pentest, health, site map, root-cause analysis,
  docs, research) keep their priority above the question check and match as substrings, since
  their patterns are whole phrases. Code-change keywords run after the question check and match
  as whole words, with inflections listed one by one, so `add` never fires inside "address" or
  `fix` inside "prefix". The audit phrasings sit below pentest so "security audit" stays a
  pentest. "site map" is the docs sense and one-word "sitemap" only counts with a verb, so a
  `sitemap.xml` feature stays feature-development. A question is a strong wh-word anywhere, an
  `in short` or `show me` lead, or a trailing `?`, unless it is a polite code request ("can you
  add a logout button?"); auxiliary leads count only through the `?`, so "do the thing" is not
  a question. It takes the raw request because normalising strips `?`. An explicit "don't code"
  or a request to write an issue is a project question, unless the same prompt asks to implement
  something. "migration" is deliberately not a code surface noun, and the word after "label" is
  skipped so "label bug" is not read as a bug.
- **Specialist phrasings and the uncertain idea.** design-test and rules-analyze (with their
  design-retest and rules-generate companions) are classification workflows of their own, so the
  pre-classifier can name them; before that they could only be reached by `paqad-ai route set`.
  Their phrasings ("audit the UI", "against the design system", "rules can become scripts") sit
  with the other named workflows above the question check. So do the discovery phrasings ("rough
  idea", "help me shape", "not sure what it should look like"), because a prompt that is still
  shaping an idea usually contains a "what" and would otherwise read as a project question. They
  rank below documentation, so "help me shape the docs" stays a docs request.
- **A source path plus an edit verb is a code change.** Refactor joins fix, add and build as a
  whole-word code keyword. After those, a prompt that names a source path (`src/`, a `.ts` file)
  and uses an edit verb anywhere ("make", "replace", "move", "rename" and the code verbs) is
  feature-development. The verb need not lead, because "In src/api/users.ts, make ..." puts the
  path first. A path with no edit verb ("check src/cart.ts") is still left to the later tiers,
  and a question about a file still reads as a question.
- **`prompt-lane.ts`.** Host-injected events (a monitor firing, a background task finishing, a
  subagent hand-back) arrive on `UserPromptSubmit` like typed prompts, so they are filtered first:
  they are not classified, write no state and leave the last human route alone. Recording
  `no-workflow` for them would pause an in-flight change and switch stage recording off. Every
  match is anchored at the start of a line, so a human prompt that only mentions a wrapper still
  routes. A prompt that is essentially just a ticket or URL leaves the lane unresolved, because
  the work behind the link could be large and its surface text must not set the safety lane;
  the filler-word list holds no domain words, so "add dark mode" plus a ticket is never bare.
  Since Claude Code 2.1.299 the hook sees a slash command as the raw typed line, so known
  commands route by name (the part after the last `:`) and an unknown one leaves the route alone,
  so `/compact` never pauses a change. The turn start is stamped on every routed prompt (never by
  a notification) so the completion check can tell this turn's rows from older ones. The lane is
  stashed only on the feature-development route, and the route is also written under this
  session's own pointer so another session can never steer the worker started for this prompt.
- **`routed-workflow.ts`.** Every message maps to one of the routing outcomes. The fine-grained
  classification union is kept; only the outcome collapses, and the map is exhaustive so a new
  union member fails to compile until it has an outcome. Only `feature-development` loads rules,
  a lane and rule scripts; only `no-workflow` retrieves nothing. The retest and generate modes
  are sub-modes of their parent.
- **`route-gate.ts`.** Feature-evidence bundles are created only for the feature-development
  route, decided from the persisted route, never from the working-tree diff. Missing route state
  means unknown, not non-feature, because only Claude Code's prompt seam writes route state and
  treating its absence as non-feature would stop all Codex and Gemini evidence. This session's
  own route pointer wins over the shared one.
- **`route-override-log.ts`.** An agent's route correction goes to a session-scoped log, not the
  stage-evidence ledger, because opening a bundle for a correction to a non-feature route would
  defeat the route gate.
- **`session-route.ts`.** The detached context worker learns the last route and prompt from a
  pointer beside the session-context artifact, since threading them through the detached chain is
  brittle. With two sessions in one checkout the shared pointer holds whoever routed last, so a
  per-session pointer is also written and preferred; the shared one is still written for older
  readers. The session id is reduced to `[A-Za-z0-9_-]` so it never leaves the directory or uses
  a character Windows forbids. With no pointer yet, the worker loads rules and retrieves.
- **`session-ownership.ts`.** The completion check enforces only for a session that owns a
  change: an unclosed bundle holds an agent-authored row (`live-mark`, `redo`) stamped with its
  id, or a row its own `paqad-<stage>` agents wrote. Inferred rows never count. The route can
  turn a detour off but never makes a non-owner enforce, and only the active route entry is read,
  so a paused change is checked again on the turn that resumes it. It is read-only and never
  calls `currentFeature` or `reconcileSessionControl`, so a Stop can never point a session at
  another session's bundle. A row recorded against a session id read from the shared cache file
  never counts, so a CLI call that resolved the wrong session cannot make this one enforce.
  Older rows use `ts` instead of `recorded_at`.
- **`workflow-state.ts`.** Switching pauses the active workflow (it is pushed with its anchors),
  routing to a paused one pops and resumes it, and routing to the same one merges anchors. An
  undefined anchor never overwrites an existing one. A Discovery entry records its run directory
  so it resumes that exact run. The function only provides the mechanism; the model decides
  intent.
- **`change-evidence.ts` and `dirty-baseline.ts`.** Changed files come from git alone: working
  tree status plus everything committed since the merge-base with `main` (else `master`). The old
  changed-files cache is never read, because a leftover copy used to hide other edits. Anything
  under a `.paqad/` home, including a nested `runtime/base/.paqad/`, is framework output and never
  changed code. `git status --short` lines must not be left-trimmed, since the first column can be
  a space and trimming drops the path's first character. At session start a digest of every
  already-dirty file is written once (an exclusive create, which avoids a check-then-write race);
  at the completion seam a file whose digest is unchanged is inherited dirt and subtracted, while
  an edited or unreadable file is kept. Commit, push and CI origins never use the baseline.
- **`feature-development-policy.ts`.** `STAGE_ORDER` is the one stage order the stage-evidence
  ledger derives from. The spec-review, spec-pipeline, reuse-first and review-digest clauses are
  each defined once, because the default policy object and the rendered YAML would otherwise
  drift; the skill directory names in them are load-bearing. The fast lane reads only the first
  reuse sentence. The explicit `rule_compliance.mode` is read from the raw project file, because
  the merged policy injects the framework default and would turn strict on everywhere, and the
  merge keeps `rule_compliance` instead of dropping it. Analytics instructions are added only
  when the flag is on and the classify-time gate said `instrument`.
- **`delivery-policy.ts`.** Precedence is framework defaults, then the detection overlay (only
  for `auto` sections), then the project YAML. Lists append uniquely so a project never silently
  loses a default.
- **`classifier.ts`.** The analytics tag checks the flag first, so with analytics off nothing is
  detected and no file is scanned.
- **`router.ts`.** A capability gap only justifies the fast lane when the task is not high
  complexity or high risk.
- **`scope-resolver.ts`.** A path in core or shared types is system-wide at once. Otherwise a
  one-hop import scan of up to eight files, bounded by a short timeout, counts other modules.
- **`confidence-scorer.ts`.** Unresolved dimensions count in the denominator, so they lower
  confidence instead of being ignored.
- **`workflow-router.ts`.** The runtime skill registry is snapshotted once per resolve, so a
  concurrent register or remove does not affect a call in flight.

## Why the `src/analytics/` code works the way it does

- **`gate.ts`.** The pass runs only when the flag is on, the change is feature-shaped and a
  provider is detected, checked cheapest first, so with the flag off detection never runs. The
  decision is written to a sidecar that the later stages read, so convention discovery happens
  once. The sidecar write is best-effort; the decision is still returned.
- **`detect.ts` and `providers.ts`.** Detection only informs and has no authority to write; the
  flag alone authorizes instrumentation. A dependency name alone is not enough (GA4 is often only
  a `gtag.js` script tag), so each provider carries several kinds of signal and the strongest
  wins, with call sites breaking ties and defining the convention. Host and URL signals are plain
  substring matches, because this is detection, not URL sanitizing, and it avoids an unanchored
  hostname regex. Call-site patterns are stored without the global flag and cloned with it in
  `call-sites.ts`, so the shared regex state is never changed.
- **`doc-tree.ts`.** One doc per event under `docs/modules/<module>/analytics/`, so it never trips
  the top-level module-doc orphan walk. Event names collapse to one slug (`Song Played` and
  `song_played` both become `song-played`), so a casing conflict is caught at write time instead
  of splitting the data. Paths are always posix. The slug trim uses an anchored single `-`, not
  `-+`, which CodeQL flags as polynomial ReDoS. An unchanged doc is not rewritten.
- **`enforcement.ts`.** The gate is whether each event doc exists, not each provider section,
  because provider detection carries confidence and blocking on a section would block falsely.
  The team value is a floor and the local config or env may only raise strictness. The default
  is `warn`, so analytics never blocks a correct build.

## Tests

- `tests/unit/pipeline/pre-classifier.test.ts`: the about-work signal and code requests that must stay on feature development.
- `tests/unit/pipeline/prompt-lane.test.ts`: notification and hand-back detection.
- `tests/unit/pipeline/session-ownership.test.ts`: `editedDevelopmentThisTurn`.
- `tests/unit/cli/route.test.ts`: refusal, the unresolved-session path and resume of a paused entry.
