---
'paqad-ai': minor
---

Ship a `decision` skill that authors Decision Pause packets — mint collision-free `D-<ULID>` ids, drive the pending → resolved lifecycle, and commit resolved packets with the PR (issue #272).

The Decision Pause Contract asks the agent to write a packet to `.paqad/decisions/pending/D-{id}.json`, present it, then move it to `resolved/` with `chosen` / `rationale` / `resolved_at`. But nothing minted the id or wrote the JSON, so an agent hand-authored the packet and pattern-matched the legacy numeric `D-1` / `D-2` / `D-3` fixtures into a sequential `D-4` — the exact id-collision the `D-<ULID>` form from #184 exists to prevent. This is the writer the contract lacked, the counterpart to `scripts/se-mark.ts` on the stage-evidence ledger.

- **New `src/decisions/authoring.ts`** (re-exported from the root `paqad-ai` barrel): `createPendingDecision` mints a `D-<ULID>` id, validates the content, and atomically writes the pending packet; `resolvePendingDecision` records the chosen option and rationale, moves the packet to `resolved/`, and stamps `resolved_at`. Both reject a non-ULID id, so a hand-picked sequential `D-{N}` can never be minted — the guarantee is enforced at creation time, not by scanning the repo.
- **New bundled `decision` skill** (`runtime/base/skills/decision/`): thin `create.mjs` / `resolve.mjs` wrappers so the agent supplies only content, never the id, timestamps, or JSON plumbing.
- **The Decision Pause Contract** (in `AGENT-BOOTSTRAP.md`) now points at the skill's create/resolve scripts, and the **delivery workflow** (`delivery-policy.yaml`) documents that a resolved decision packet is committed with the change it justifies, so a reviewer and future `git blame` can see why.
