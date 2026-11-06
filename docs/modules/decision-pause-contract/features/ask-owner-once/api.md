# Ask the Owner Once: API View

> Module: **Decision Pause Contract** (`decision-pause-contract`) · Layer: `framework-internals` · Feature slug: `ask-owner-once`

## `paqad-ai spec pipeline round`

Prints the question round for the session's active change as one JSON line. Options:
`--project-root`, `--session`. Read-only.

```ts
// src/spec-pipeline/round.ts
export const ROUND_BATCH_SIZE = 4;

interface QuestionRound {
  change: string;                 // the change key
  opener: string | null;          // null when nothing was ruled compatible
  merged: { target: string; merged_claim: string }[];
  packets: { id: string; category: string; title: string; recommendation: string | null }[];
  batches: string[][];            // packet ids, oldest first, 4 per batch
}

export function buildQuestionRound(projectRoot: string, dirName: string): QuestionRound;
```

`packets` holds only pending packets whose `change` equals this change. The opener is
"The experts agreed on N point(s) after merging overlaps" followed by a `<details>` list of
`- <target>: <merged_claim>`.

## `paqad-ai decision` verbs for earlier answers

| Command | What it does |
| --- | --- |
| `decision create ... [--ask-anyway]` | Opens a packet and prints `earlier_check` with the earlier titles when any earlier answer is eligible. Prints `reused: true` when a standing answer settled it. `--ask-anyway` asks this one time, with the same check. |
| `decision check <id>` | While the check is required, prints the titles or candidates and the method. Once done, prints the `question` block. |
| `decision check <id> --read <D-id> ...` | Prints up to 5 offered answers in full. Writes nothing. Exits 1 and prints no answer for an id not offered, more than 5 ids, or a packet with no `earlier_check`. A repeated id counts once. |
| `decision suggest <id> --earlier <D-id> --option <key> --reason <text>` | Records the earlier answer that fits. The key belongs to the open question. |
| `decision suggest <id> --none --reason <text>` | Records that none fits. |
| `decision resolve <id> <key> [--always]` | Resolves. Refuses while the check is required. `--always` also keeps a standing answer. |
| `decision standing list` | Lists standing answers. |
| `decision standing remove <id>` | Removes one. Refused for a stage agent. |

Commit the resolved packet with the change it justifies, and
`.paqad/decisions/standing-answers.json` with it when a rule was added or removed.

### The two kinds of check

A question an agent opens with `decision create` or `create.mjs` prints one line of JSON:

```json
{ "id": "D-...", "path": "...", "earlier_check": {
  "required": true,
  "method": "<text of the skill's reference file>",
  "next": "Read up to 5 with paqad-ai decision check <id> --read <D-id> ... Then paqad-ai decision suggest <id> --earlier <D-id> --option <key> --reason <text>, or --none --reason <text>",
  "older_omitted": 12,
  "missing": ["D-..."],
  "titles": [ { "id": "D-...", "category": "...", "question": "..." } ]
} }
```

`older_omitted` and `missing` appear only when they apply. Rows run newest first, with the greater
id first on a tie. A title over 140 characters prints cut at 140 with `…`, and `--read` prints it
whole. The output stays under 24,000 characters, so it holds at most 200 rows and stops adding rows
before the limit. `older_omitted` counts the older answers left out. Only printed rows are offered,
so `--read` and `suggest --earlier` refuse any other id. `suggest` accepts any offered id, read or
not, and `--none` needs no read. With no eligible earlier answer the output is exactly
`{ "id", "path" }`.

A packet from an automated caller or `DecisionStore.writePending` keeps the word match. Its check
exists only on a match at 0.5 or more, and `decision check` prints full `candidates` with `id`,
`category`, `question`, `context`, `chosen`, `chosen_label`, `why` and `resolved_at`, then `method`
and `next`. `--read` prints those same fields, for either kind of check, required or done.

The `question` block's shape depends on how the packet was opened. A packet from
`decision create` has an `other` write-in command. A store-shape packet, from an automated caller,
has no `other`, holds up to four entries and lists a fifth option under `not_shown` with its
resolve command. `--other` on a store-shape packet is refused with `This question takes only its
listed options, so --other can't be used. Pick one of them.`

## Synthesis rulings

Each row in the synthesis input's `conflicts` array (read by `paqad-ai spec pipeline experts
synthesis`, validated by `validateExpertSynthesis` in `src/spec-pipeline/experts/synthesis.ts`)
takes one of two shapes:

```json
{ "target": "src/x.ts", "ruling": "pick", "recommendation": "<one claim verbatim>", "rationale": "..." }
{ "target": "src/x.ts", "ruling": "compatible", "merged_claim": "<one claim>", "rationale": "..." }
```

- A missing `ruling` reads as `pick`.
- `pick` mints one `spec.expert_conflict` packet. `compatible` mints none and writes a merged
  finding; the command prints `compatible: <n>`.
- Refused: an unknown ruling, an empty `merged_claim`, and `compatible` on a conflict holding a
  must-level `security-auditor` finding.

## `defer` escalation

`FEATURE_DEVELOPMENT_ESCALATION_ACTIONS` is now `warn | ask | stop | defer`
(`src/core/types/feature-development-policy.ts`). The default for `attribution_pending` is
`defer`: an unsure module attribution keeps planning moving with `no-attribution` as a
provisional label and its packet joins the round. Set `stop` to keep the old behaviour.

## `peekActiveChangeKey`

```ts
// src/feature-evidence/stage-ledger.ts, re-exported from src/stage-evidence/live-writer.ts
export function peekActiveChangeKey(projectRoot: string, hint?: string | null): string | null;
```

Read-only form of `activeChangeKey`, used by `runtime/hooks/decision-pause-gate.mjs`. The session
is `hint`, then `SE_SESSION`, then `CLAUDE_SESSION_ID`. It reads only that session's control file
and returns `null` when there is no session, no active bundle, or the bundle is closed. It never
adopts a change and never writes. A `null` makes the gate block on every pending packet.
