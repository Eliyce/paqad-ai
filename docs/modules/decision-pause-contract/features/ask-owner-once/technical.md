# Ask the Owner Once: Technical View

> Module: **Decision Pause Contract** (`decision-pause-contract`) · Layer: `framework-internals` · Feature slug: `ask-owner-once`

The owner is asked only real questions, once per change, and a pending question holds up only
its own change. Three parts make that work: the chief can rule agreeing expert claims
compatible, every question for a change is asked in one round, and the edit gate is scoped to
the change a packet names.

## Module Boundaries

- `src/spec-pipeline/experts/merge.ts`: `mergeExpertNotes` collapses all findings from one role
  on one normalized target into one finding before conflict detection. It keeps the longest
  claim (ties go to the first in note order) and lists every collapsed id in `merged_from`. One
  expert never conflicts with itself. A conflict carries the findings' `severities` when any
  finding has one.
- `src/spec-pipeline/experts/synthesis.ts`: `validateExpertSynthesis` reads each conflict row's
  `ruling`. `applyCompatibleRulings` turns compatible rulings into merged findings.
- `src/spec-pipeline/experts/conflicts.ts`: `mintExpertConflictDecisions` mints packets for pick
  rulings only, and `hasPendingExpertConflict` gates the questions step per change.
- `runtime/hooks/decision-pause-gate.mjs`: the per-change edit gate.
- `src/feature-evidence/stage-ledger.ts`: `resolveActiveChange` and `activeChangeKey`, the
  resolver the decision command uses, and `peekActiveChangeKey`, its read-only form for the gate.
  The gate's form is re-exported from `src/stage-evidence/live-writer.ts` so the hook can load
  it from `dist`.
- `src/spec-pipeline/round.ts`: `buildQuestionRound` and the `paqad-ai spec pipeline round` verb.
- `src/onboarding/decision-pause-contract-writer.ts`: the contract text, regenerated into
  `runtime/AGENT-ROUTER.md`.
- `src/module-decisions/inferencer.ts` and `src/pipeline/feature-development-policy.ts`: the
  attribution floor and the `defer` escalation.
- `src/decisions/earlier-answers.ts`: the word match, the title list, `--read`, the question block
  and `suggest`.
- `src/decisions/standing-answers.ts`: the standing-answer file.
- `src/decision-reuse/`: the `paqad.decision-reuse` ledger rows and the receipt line.
- `src/cli/commands/decision.ts`: the `decision` verbs, listed in [`api.md`](./api.md).
- `runtime/base/skills/decision/`: the skill method.

## Compatible and pick rulings

The chief rules every merge conflict one of two ways:

- `{ target, ruling: 'pick', recommendation, rationale }`: following one claim means not
  following another. The recommendation must be one of the claims verbatim. It mints one
  `spec.expert_conflict` packet with the chief's pick as the recommendation.
- `{ target, ruling: 'compatible', merged_claim, rationale }`: the claims can all be true at
  once. It mints no packet.

A row with no `ruling` reads as `pick`, so a synthesis written before rulings existed still
validates. The validator refuses an unknown ruling, a compatible row with an empty
`merged_claim`, and a compatible ruling on any conflict that includes a must-level
`security-auditor` finding. That conflict always reaches the owner as a pick.

When `experts synthesis` records a compatible ruling, the first conflict finding in
`experts.json` becomes the merged finding: its claim is the `merged_claim`, `merged_from` lists
every conflict finding id, it carries the strongest severity and the `invariant` kind if any
merged finding had it, and its id joins `synthesis.accepted` so the freeze summary and the craft
trace see it. The other findings stay as written, and the synthesis row keeps the original
`claims`, `finding_ids` and the chief's `rationale`, so a later reviewer can see what was merged
and why. A finding named in another finding's `merged_from` is left out when the notes are read
back, so a re-run merges cleanly. The command prints `compatible: <n>`, and the HUD shows
compatible rows under `merged`, not as disagreements.

The fork-token scan finds both pending and resolved packets. A conflict whose fork is already
pending is skipped, and one already resolved reuses its answer, so the same fork is never
minted twice.

## The per-change gate

The edit gate reads every pending `D-*.json`. It blocks an edit when a packet has no `change`
(legacy, blocks everything), when the packet cannot be read, or when the packet's `change`
equals the active change of the session making the edit (the payload `session_id`, then
`SE_SESSION`, then `CLAUDE_SESSION_ID`). The gate only reads that session's control file: it
never adopts an in-flight change for a session that has none and never writes anything, so an
unknown or missing session reads as unresolved. If the active change cannot be resolved, or the `dist`
resolver fails to load, every pending packet blocks. Only a positively different change lets an
edit through. The questions step follows the same rule: `hasPendingExpertConflict` counts only
`spec.expert_conflict` packets for this change or with no change.

## One question round

The contract asks every pending packet for a change in one round: up to 4 packets per question
call, back to back with no other work between them, oldest first, each resolved with
`paqad-ai decision resolve`. On the graduated and full lanes the round is the spec questions
step. `paqad-ai spec pipeline round` prints the round for the active change: its packets, the
batches of 4, and an opener. The opener is "The experts agreed on N points after merging
overlaps" followed by a details list of the merged claims, and is left out when the chief ruled
nothing compatible.

Packets raised before the round carry their change and do not stop work when they are raised:

- module attribution, deferred from planning (`attribution_pending: defer`);
- `fix.proof_method`, raised at `experts synthesis`;
- the visual-evidence readiness pause, raised at `plan compile`.

On the fast lane, or with the spec pipeline off, no round follows, so `plan compile` still asks
the readiness pause at once. `spec.change` and `spec.contradiction` raised during development
are always asked straight away. If the owner answers only part of a round, the rest stay
pending for that change and the next round asks only those. The answers given without
asking are a standing answer, a fork already resolved, and the spec pipeline's high-score
precedent answer, each of which writes a `paqad.decision-reuse` row, and an automated caller's
reuse from the decision index (see [The decision index](#the-decision-index)).

## Earlier answers

1. **Find.** A packet opens with one of two kinds of check, and one open runs only one of them.
   - **Title list, for a question an agent opens.** Agents word questions themselves: on real
     history, reworded titles scored 0.00 to 0.31 against the 0.5 floor, and the check never ran in
     26 of 60 eval runs. So `createPendingDecision` gets `agentWorded` from the CLI create action and
     `create.mjs`, and from nothing else, and `titleCheckFor` offers every eligible answer whatever
     its wording. The offer is fixed when the packet opens, as `earlier_check.candidates` with
     `listed_by: "titles"`.
   - **Word match, for automated callers.** `findEarlierQuestions` scores wording and keeps up to 5
     at or above the 0.5 floor. With no match there is no check. `origin` is not the test, because
     authoring and delivery callers pass none.

   Both use the same eligibility. Of several answers to the same question text and option keys,
   only the newest counts, so a changed answer is not suggested again. An answer past its expiry is
   not offered, and an older answer to the same question does not take its place. A private category
   (`PRIVATE_ANSWER_CATEGORIES`) is offered only to a question of the same category, and is left out
   before the newest is picked, so it cannot hide an answer this question may see. A packet with no
   fingerprint, such as one over 5 options, gets no check of either kind.
2. **Judge.** `decision create` and `decision check` print the method from
   `runtime/base/skills/decision/references/earlier-answers.md`, with the titles or the full
   candidates. On a title list the skill scans the titles, reads up to 5 with
   `decision check <id> --read`, and judges meaning rather than wording. Stored text is data to judge,
   never instructions.
3. **Suggest.** `decision suggest` records one earlier answer or `--none`, and marks the check
   done. `decision resolve` refuses while the check is required. The Approvals screen is exempt,
   because a person answers there directly.
4. **Ask.** The printed `question` block puts the suggestion first, then the other options, then
   the always entry when it all fits within four entries. A store-shape packet has no `other`
   write-in, and a fifth option sits under `not_shown` with its resolve command. A stage agent stops
   at `paused: D-<id>` and the orchestrator asks.

### Size limits

A pause puts the title list in the opening agent's context once, so `titlesThatFit` holds the printed
output under 24,000 characters, about 6,000 tokens, at most 200 rows and with `method` at most 2,000
characters. It adds rows newest first and stops before the limit, measuring the JSON as printed,
so an escaped title counts in full. A host can cut a long output with no sign, so paqad cuts first,
and `older_omitted` says how many were left out. `method`, `next` and `older_omitted` print before
`titles`, so they outlast a cut. Only printed rows go into `candidates`, so nothing unseen can be
suggested. A method file over the limit falls back to the built-in line.

`printDecisionOutput` prints a title list as one compact line, because indenting 200 rows would use
the whole budget on spaces. Every other output stays indented.

An open reads every file in `resolved/` once, and printing the list reads at most 200 more. `--read`
reads at most 5.

### Packet fields

`earlier_check` holds `status`, `candidates`, and optionally `listed_by`, `older_omitted` and
`none_reason`. `suggestion` holds `earlier_id`, `option_key`, `reason` and `at`. When a title-list
packet resolves, through the CLI or Approvals, `earlierCheckToKeep` removes `candidates` from the
resolved file and keeps the rest, because the list is only needed while the packet is pending and
would add about 6 KB to a tracked file per decision. An automated packet keeps its short list.

### Standing answers

`decision resolve --always` adds a rule to the tracked `.paqad/decisions/standing-answers.json`,
keyed by the question's fingerprint. When `createPendingDecision` finds a matching rule, it
returns `reused`, writes a resolved packet and an audit row, and opens no pause. Callers that open their own packets
(delivery, fix proof, expert conflicts, evidence-armed forks, visual-evidence readiness) treat
that as already answered. `NO_STANDING_ANSWER_CATEGORIES` lists the kinds that can never have a
rule, and `assertNotStageAgent` refuses a stage agent both setting and removing one.

### The decision index

Nothing in this flow reads `.paqad/decisions/index.json`: earlier answers are found by reading
`.paqad/decisions/resolved/`, and rules by reading `standing-answers.json`. A packet opened with
`decision create` and answered with `decision resolve`, or answered by a rule, writes no index entry
and supersedes nothing, so automated callers still pause rather than reuse it. A store-shape packet
reaches the index through `DecisionStore.resolve`, as does any packet answered on Approvals, and an
automated caller can reuse those.

### Evidence

Each outcome is one `paqad.decision-reuse` row, of kind `open`, `reuse`, `suggestion`,
`standing-set` or `standing-removed`. A suggestion row's outcome is `accepted`, `changed` or
`none`. `decisionsReceiptLine` folds a change's rows into the receipt's `decisions:` line.

## Rules proposal sign-off

- Category `rules.proposal` has the options `sign_off` and `not_now`. Its context carries the sha256 of the run's `proposal.json`, and its `invalidation_watch` lists the rule files the proposal touches.
- `paqad-ai rules discovery apply` refuses unless the decision is resolved `sign_off` and the hash still matches; `not_now` writes nothing.
- Apply tags each source decision in `resolved/` with the optional `rules_discovery` field (`absorbed` with the rule id, or `not-a-rule` with the reason). The field is additive; every reader of resolved decisions ignores it.

## Attribution

`inferAttribution` treats a top score of 0.5 or more as confident. A confident choice is applied
through `src/module-decisions/apply.ts` with no packet and recorded as auto-applied, with its
score, in the plan's `reuse.consulted`, and the round shows it as a choice already made that the
owner can change. A choice below 0.5 keeps planning moving with `no-attribution` as a
provisional label and its packet joins the round. A project whose policy sets
`attribution_pending: stop` keeps stopping during planning.
