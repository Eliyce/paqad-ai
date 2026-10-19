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

## The about-work signal (issue #623)

`isAboutWorkPrompt(requestText)` in `pre-classifier.ts` marks a prompt that talks about the work rather than asking to change code. It routes the prompt to `project-question`, ahead of the code-change tier.

- It never fires when the prompt names code: a source path or source-language file, a strong code verb (fix, implement, build, refactor, develop), or a code surface noun (page, endpoint, component, test, bug and so on). It reads the raw request, because paths and extensions are lost to normalization.
- It fires on a tracker noun (issue, ticket, PR, pull request, a draft, the rewrite) with a work verb, or on a soft work noun (report, plan, doc, research) with a tracker verb (post, file, link, recheck, confirm) or with a tracker target (GitHub, Jira, Linear) and a work verb.
- When the prompt also carries a code keyword such as "add", a tracker noun or target must be named, so a real code request is never routed away from feature development.
- A separate fallback routes a prompt with a tracker verb and no code to `project-question` when nothing else matched. It never outranks a code keyword.

## Notifications and hand-backs (issue #623)

`isSystemNotificationPrompt` in `prompt-lane.ts` keeps text that is not the person's own input out of routing. A prompt counts as a notification when:

- it starts with one of the notification elements (such as `<task-notification>`), or
- the banner `[system notification - not user input]` is a line of its own and some line opens with a notification element, which catches a report that comes first, or
- it is a foreground subagent hand-back: a line opens an `<agent-message …>` element and a line opens with `[subagent hand-back]` (`SUBAGENT_HANDBACK_MARKERS`).

Each marker must open its own line. A human prompt that quotes one of them inline, or only one of them, still routes.

## Route correction (issue #623)

`paqad-ai route set <workflow>`:

1. Resolves the session from `--session`, then `SE_SESSION`, then `CLAUDE_SESSION_ID`.
2. Refuses to leave `feature-development` only when `editedDevelopmentThisTurn(root, session)` is true: this session wrote an agent-authored `development` row in an unclosed bundle at or after the turn's `turn_started_at`. It reads the session's own rows, never the shared git tree, so another session cannot block it. Rows recorded against a session id read from the shared cache file do not count. With no turn stamp, any owned `development` row counts.
3. When no session was named at all, skips the check, allows the correction and records `UNRESOLVED_SESSION_REASON` in the audit row.
4. Rewrites the active workflow-state entry. If the target sits in the paused stack, the most recent matching entry is resumed with its plan, spec and lane anchors and taken off the stack. Otherwise a fresh active entry is set and the paused stack is left alone. The mislabelled entry is replaced, never paused.
5. Updates `.session-route.json`, clears a stashed lane when the new route is not feature development, and appends an `agent-override` row to `.route-overrides.jsonl` in the session's stage-evidence ledger.

## Lanes

`paqad-ai lane set <fast|graduated|full>` writes the lane on the active change's `feature.json` through the monotonic ratchet: it can raise the lane, and a downgrade is refused and reported. The end-of-change checks read that recorded lane.

## Tests

- `tests/unit/pipeline/pre-classifier.test.ts`: the about-work signal and code requests that must stay on feature development.
- `tests/unit/pipeline/prompt-lane.test.ts`: notification and hand-back detection.
- `tests/unit/pipeline/session-ownership.test.ts`: `editedDevelopmentThisTurn`.
- `tests/unit/cli/route.test.ts`: refusal, the unresolved-session path and resume of a paused entry.
