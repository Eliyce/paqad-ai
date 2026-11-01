---
name: decision
description: 'Writes and resolves Decision Pause packets through the bundled create.mjs and resolve.mjs scripts, so the agent never hand-authors the id, timestamps or JSON. Use when a choice falls into a Decision Pause category, or when the user answered a pending decision that must be resolved.'
metadata:
  model_tier: fast
  cacheable: 'false'
  output_format: json
  paqad-meta: skill.meta.yaml
---

## What It Does

Drives the pending → resolved lifecycle of a **Decision Pause packet**, the
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
(the collision-free form, enforced at creation time).

This is the _contract_ packet: distinct from the rich `DecisionPacket`
(`src/planning/decision-packet.ts`) that the automated intake / reuse pipeline
mints and consumes. See `references/decision-packet-contract.md`.

## Use This When

- A choice falls into a Decision Pause category and you must record it before
  implementing (see the Decision Pause Contract's category list).
- You are about to hand-author a `D-{id}.json` packet: use this instead.
- The user has answered a pending decision and you need to resolve it and commit
  the resolved packet with the change it justifies.

## Inputs

- `project_root` (path, optional): defaults to cwd.
- For `create`: `category`, `title`, `context`, and two or more `<key>=<label>`
  `options` (optional `recommendation` key).
- For `resolve`: the packet `id` and the `chosen` option key (optional rationale).

## Procedure

1. **Create.** Run:

   ```bash
   node scripts/create.mjs <project-root> \
     --category <category> --title <title> --context <context> \
     --option <key>=<label> --option <key>=<label> [--recommendation <key>]
   ```

   Capture the `id` from the JSON output.

2. **Present.** Surface the options to the user via the host's interactive UI (on
   Claude Code, the `AskUserQuestion` tray). Ask one packet at a time in creation
   order; ids sort chronologically.

3. **Resolve.** Once the user answers, run:

   ```bash
   node scripts/resolve.mjs <project-root> <id> <chosen> [rationale]
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
  move: always go through the scripts.
- If `create` reports a validation error, fix the content and re-run; do not work
  around it by writing the file yourself.
- If the interactive UI is unavailable (non-interactive run, hook context), stop
  and wait until the resolved packet exists, per the contract's fallback.

## Resources

- `references/decision-packet-contract.md`: packet shape, lifecycle, and rules.
