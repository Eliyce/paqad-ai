# Decision Pause Contract

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `decision-pause-contract`

## Purpose

Agent-side contract enforced by `CLAUDE.md` / `AGENTS.md`: before any
flagged choice the agent writes a Decision Packet to
`.paqad/decisions/pending/D-{id}.json` and stops until the resolved
packet exists. Routed through the interactive question UI when
available.

### One packet shape

`paqad-ai decision create` (`createPendingDecision` in `src/decisions/authoring.ts`) writes a
packet that keeps every contract field (`id`, `title`, `options`, `chosen` once resolved) and
also carries the rich `DecisionPacket` fields (`decision_id`, `question`, `fingerprint`,
`human_response` once resolved). So Approvals, the completion gate, decision precedents and
the spec pipeline's auto-answer all see the same packet the edit gate counts. A packet that
cannot be a `DecisionPacket` (a category outside the canonical list, or more than five
options) is stored in contract shape alone.

`readAnyDecisionPacket` (`src/decisions/packet-shape.ts`) is the one tolerant reader:
`DecisionStore` and the precedent scan read through it, so a contract-only packet written
before this change is upgraded in memory, never rewritten. A malformed pending file belongs
to no task, so it no longer blocks `writePending`.

### Decision-precedent enrichment (RAG buildout F25)

When a pause opens, `DecisionStore.writePending` enriches the packet's context with the
top few SIMILAR prior resolved decisions (read from `.paqad/decisions/resolved/**`), so
the developer sees the precedents they already set when answering. Ranking is
deterministic — same category plus question/context token overlap (`src/planning/decision-precedents.ts`,
`findDecisionPrecedents` / `formatDecisionPrecedents`) — with no embeddings and no LLM
call, capped to keep the token cost low and best-effort so a missing/corrupt store never
breaks the pause. It complements `findReusableDecision` (which auto-reuses an exact-kind
match) by only ADVISING on related-but-not-identical precedents the human still decides.

### The visual-evidence readiness pause

`plan compile` opens one packet itself, through `createPendingDecision`, when visual evidence
is on, the change is frontend (plan step files plus changed files), and this machine cannot
capture screenshots yet (the same readiness checks `paqad-ai doctor` shows). It reuses the
existing `workflow-or-tool` category, is titled "Visual evidence is on, but I can't capture
screenshots here yet", lists the reasons, and offers `setup`, `attach` and `waive`. Its
context carries a `[paqad-ve-readiness <bundle>]` token, so a re-run of `plan compile` for
the same change opens no second packet, and the visual-evidence gate can find the answer: a
resolved packet with `waive` makes a strict "nothing captured" read `skipped` ("waived by
D-<id>"), never pass. Like every pending packet it holds the next edit until it is resolved
(`src/visual-evidence/readiness.ts`).

## Source Footprint

- `.paqad/decisions`
- `src/planning/decision-precedents.ts`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Why the `src/planning/` code works the way it does

`src/planning/` holds the decision store and its helpers, plus a few planning-time checks. The
reasons below are not obvious from the code.

- **Ids (`decision-packet.ts`, `decision-store.ts`).** New packets get a `D-<ULID>` id. ULIDs sort
  by time and never collide across machines, so two developers on parallel branches never mint
  the same id; the old `max + 1` walk did, which caused hard merge conflicts and needed a
  per-machine lock. Only the write path is strict: a hand-written sequential id passes read
  validation, so creation rejects it explicitly. Reads and directory listings still accept the
  legacy numeric `D-<n>` form so existing packets keep working.
- **The store (`decision-store.ts`, `decision-events.ts`, `decision-ledger.ts`).** The pending
  and resolved packet files are what the gates read and are never replaced. Lifecycle events are
  also folded onto the session ledger under the project sentinel session, because decisions
  outlive one conversation; the current state is the latest row per id. Event payloads use
  project-relative paths so a home path never leaks. A pending cap (overridable in the profile)
  refuses a new packet but never a rewrite of the same one, and the cap event is emitted before
  the throw so a consumer still learns of it. Precedents are added only after validation, so a
  malformed packet still fails validation. A malformed pending packet belongs to no task, so it
  never blocks a new one, and a packet in the older `decision create` shape is upgraded in memory
  instead of reading as corrupt. A corrupt packet error carries a stable taxonomy code. A discard
  removes the pending file without copying it to resolved.
- **Self-arm (`decision-selfarm.ts`, `decision-detector.ts`).** The minter writes at most one
  pending packet so the existing gate blocks the next edit; it never blocks by itself. It mints
  only on two high-confidence forks: create-vs-reuse, and the tight architecture-path signal (two
  distinct file paths offered as alternatives). The broad architecture-path signals and the
  component-reuse signal stay below the bar, so a stray "or" cannot mint a pause. It never mints
  over a pending packet or for a fork already resolved. It is on by default only on the
  feature-development route (read from the per-session workflow state, active or paused); the
  env variable or `decision_selfarm` in `.paqad/.config` can force it either way.
- **Evidence-armed pauses (`decision-evidence-arm.ts`, `decision-arm-config.ts`,
  `decision-evidence.ts`).** Every guard exists because a false pause blocks real work.
  `decision_arm_mode` is a floored capability mode (the team value is a floor; local and env can
  only raise it) and ships as `warn`. The numeric knobs are ordinary local-wins values. Both
  triggers share one evidence builder so plan-time and change-time proof mean the same thing.
  Fork identity and the change id ride in the packet context as machine tokens rather than new
  storage, so a fork is never asked twice and a re-run of `plan compile` cannot exceed the
  per-change cap; a fork answered earlier applies that answer and records a decision-reuse row.
  Forks over the cap are reported, never dropped. A construct whose name already exists is not a
  fork. Without a code-knowledge index nothing is scored or minted, and an index miss means "fall
  back", never "zero callers". A missing mtime is marked partial instead of guessed. Any failure
  degrades to nothing armed, so arming never fails `plan compile` or the duplication scan.
- **`symbol-similarity.ts`.** Edit distance alone misses near-copies like `formatRelativeDate` and
  `formatIsoDate`, so the score is token agreement first (Dice, plus a bonus for the same first or
  last token) with edit distance as the other reading. It is calibrated so that head or tail
  agreement alone stays below the default threshold: reading and writing the same thing is not a
  reuse fork.
- **`decision-precedents.ts`.** Precedents are ranked deterministically (same category plus
  question and context token overlap), with no embeddings, and capped. They only advise; exact
  reuse is `findReusableDecision`'s job, so an exact-fingerprint match is excluded. The tolerant
  reader is used so answers recorded with `decision resolve` count too.
- **`decision-packet-builder.ts`.** The intake, delivery and spec-lifecycle categories return no
  options here, so a caller that routes them through file evidence fails validation loudly.
- **`rule-compiler.ts`.** A rule gated on a flag that is off is excluded before rule ids are
  assigned, so none of its bytes reach the compiled store and `RULE-n` stays contiguous; a
  malformed config excludes every gated rule. Inferred triggers come only from inline code that
  looks like a path or glob, after fenced blocks are stripped, because loose spans exploded the
  manifest; with none the rule falls back to `**`.
- **`module-health-updater.ts`.** Results from weakly tooled languages are shown in evidence but
  never rolled into the module metric. A gate that measured nothing is not counted as a pass.
  Consumed evidence files are deleted, since their content is already folded into the profiles.
- **`reconnect-check.ts`.** The check anchors on the written frozen spec, never on the agent's
  memory of the feature, because that fades on long jobs; an unfrozen spec is never coherent. It
  is structural by default and adds an agent re-read on the full lane.
- **`ticket-ref-detect.ts`.** Detection is regex-only and never fetches, so it can run on every
  prompt; the fetch is the explicit verb the arming line names.
- **`doc-target-resolver.ts`.** `posix.join` keeps doc targets forward-slashed on Windows.

## Why the `src/decisions/` and `src/decision-reuse/` code works the way it does

- **`decisions/authoring.ts`.** Left to write the JSON by hand, an agent copies the old numeric
  `D-1`, `D-2` fixtures and continues the sequence, so two branches mint the same id. The writer
  mints the `D-<ULID>` id and timestamps itself, and `assertContractDecisionId` rejects any other
  shape through the one shared id guard, so the contract and automated paths never carry two id
  regexes. This contract packet is kept apart from the rich `DecisionPacket` that `DecisionStore`
  mints, because it is a readable trail committed with the PR. Options are copied field by field
  so a caller cannot add extra keys, and `evidence` is kept only when an option has it. `origin`
  is set only on a machine-minted packet, so an asked question can be told from a detected one.
  A packet opened with no change is linked to the change active at resolve; one that already
  names a change keeps it. The rich-only keys are dropped before re-deriving so a stale copy
  never lingers. The reader skips a missing folder or a malformed packet. A write-in answer
  becomes option `other` (or `other-2` and so on), never a duplicate.
- **`decisions/packet-shape.ts`.** A resolved contract packet records a human answer, never a
  model guess.
- **`decision-reuse/`.** Every reuse of a resolved decision in a session appends to one unit on
  the session-ledger substrate. Recording is best-effort and never breaks the decision flow. The
  schema lives in `src/`, never under `.paqad/`, so the model cannot weaken it. A row proves a
  reuse was observed, not that it was correct.

## Authority

The single source of truth for this module's identity, slug, feature names, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml). If anything
in this page disagrees with the map, the **map wins** — update the map first, then regenerate this
page via `create module documentation`.

## How to Update These Docs

1. Edit `docs/instructions/rules/module-map.yml` if the module or feature names changed.
2. Run `create module documentation` in your AI agent (Claude Code, Codex, Cursor, …).
3. Review the regenerated business + technical pages per feature.

## Related

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
