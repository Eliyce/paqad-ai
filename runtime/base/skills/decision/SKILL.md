---
name: decision
description: Authors the small, human-facing Decision Pause packet described by the Decision Pause Contract (in the framework bootstrap AGENT-BOOTSTRAP.md) without the agent hand-authoring the id, timestamps, or JSON. `create` mints a collision-free `D-<ULID>` id and writes the pending packet; `resolve` records the chosen option and rationale and moves it to resolved. A hand-picked sequential `D-{N}` is rejected, so two developers on parallel branches never collide (issue #272). The writer lives in `src/decisions/authoring.ts`; this skill is the agent-side wrapper that invokes the bundled `create.mjs` / `resolve.mjs` scripts, the exact counterpart to `scripts/se-mark.ts` on the stage-evidence ledger.
model_tier: fast
triggers:
  - workflow:
      - feature-development
      - documentation-update
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  project_root:
    type: path
    required: false
    description: Project root used to resolve `.paqad/decisions/`. Defaults to cwd.
  category:
    type: string
    required: false
    description: Decision Pause category (e.g. workflow-or-tool, architecture-path). Required by `create`.
  title:
    type: string
    required: false
    description: One-line question the decision answers. Required by `create`.
  context:
    type: string
    required: false
    description: The situation and trade-offs the user needs to weigh. Required by `create`.
  options:
    type: string[]
    required: false
    description: Two or more `<key>=<label>` option pairs. Required by `create`.
  id:
    type: string
    required: false
    description: The `D-<ULID>` id of a pending packet. Required by `resolve`.
  chosen:
    type: string
    required: false
    description: The `option_key` the user selected. Required by `resolve`.
---

## What It Does

Drives the pending → resolved lifecycle of a **Decision Pause packet** — the
readable decision record the Decision Pause Contract asks the agent to write to
`.paqad/decisions/`. The mechanical parts (minting the id, stamping timestamps,
writing and moving the JSON) run inside the bundled scripts so the agent supplies
only content, never id/lifecycle plumbing:

- `create.mjs` mints a collision-free `D-<ULID>` id and writes the pending packet
  to `.paqad/decisions/pending/D-<ULID>.json`.
- `resolve.mjs` records the chosen option and rationale, moves the packet to
  `.paqad/decisions/resolved/D-<ULID>.json`, and stamps `resolved_at`.

A hand-written sequential `D-{N}` is rejected: a new packet can only carry a
minted ULID id, so two developers on parallel branches never allocate the same id
(issue #184's collision-free form, now enforced at creation time — issue #272).

This is the _contract_ packet — distinct from the rich `DecisionPacket`
(`src/planning/decision-packet.ts`) that the automated intake / reuse pipeline
mints and consumes. See `references/decision-packet-contract.md`.

## Use This When

- A choice falls into a Decision Pause category and you must record it before
  implementing (see the Decision Pause Contract's category list).
- You are about to hand-author a `D-{id}.json` packet — use this instead.
- The user has answered a pending decision and you need to resolve it and commit
  the resolved packet with the change it justifies.

## Inputs

- `project_root` (path, optional) — defaults to cwd.
- For `create`: `category`, `title`, `context`, and two or more `<key>=<label>`
  `options` (optional `recommendation` key).
- For `resolve`: the packet `id` and the `chosen` option key (optional rationale).

## Procedure

1. **Create.** Run:

   ```bash
   node runtime/base/skills/decision/scripts/create.mjs <project-root> \
     --category <category> --title <title> --context <context> \
     --option <key>=<label> --option <key>=<label> [--recommendation <key>]
   ```

   Capture the `id` from the JSON output.

2. **Present.** Surface the options to the user via the host's interactive UI (on
   Claude Code, the `AskUserQuestion` tray). Ask one packet at a time in creation
   order; ids sort chronologically.

3. **Resolve.** Once the user answers, run:

   ```bash
   node runtime/base/skills/decision/scripts/resolve.mjs <project-root> <id> <chosen> [rationale]
   ```

4. **Commit.** Stage the resolved packet with the change it justifies, so a
   reviewer and future `git blame` can see _why_ (delivery workflow).

## Output Contract

- `create.mjs` prints `{ "id", "path" }` (the minted id and the pending file).
- `resolve.mjs` prints `{ "path" }` (the resolved file).
- Both exit non-zero with a message on stderr for a usage or validation error
  (missing field, fewer than two options, non-ULID id, unknown `chosen` key).

## Escalate / Stop Conditions

- **Never hand-edit** the packet JSON, its timestamps, or the pending/resolved
  move — always go through the scripts.
- If `create` reports a validation error, fix the content and re-run; do not work
  around it by writing the file yourself.
- If the interactive UI is unavailable (non-interactive run, hook context), stop
  and wait until the resolved packet exists, per the contract's fallback.

## Resources

- `references/decision-packet-contract.md` — packet shape, lifecycle, and rules.
