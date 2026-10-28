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
pending for that change and the next round asks only those. Nothing is auto-answered.

## Attribution

`inferAttribution` treats a top score of 0.5 or more as confident. A confident choice is applied
through `src/module-decisions/apply.ts` with no packet and recorded as auto-applied, with its
score, in the plan's `reuse.consulted`, and the round shows it as a choice already made that the
owner can change. A choice below 0.5 keeps planning moving with `no-attribution` as a
provisional label and its packet joins the round. A project whose policy sets
`attribution_pending: stop` keeps stopping during planning.
