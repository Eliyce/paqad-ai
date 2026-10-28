# Rule Stop and Allow Once: Technical View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `rule-override`

## Module Boundaries

- `src/hud/last-block.ts`: the per-session rule-stop record (write, read, mark allowed once,
  take the allowed-once mark, clear).
- `src/rule-scripts/override.ts`: `applyRuleOverride`, the checks before an override is recorded,
  and `recordEditOutcome`, the checks before an outcome line is recorded.
- `src/feature-evidence/rule-overrides.ts`: the `rule-overrides.jsonl` bundle file.
- `src/cli/commands/rules.ts`: `paqad-ai rules override`, with `--outcome` for the outcome line.
- `src/kernel/gate.ts`: `runCapabilityGate` and its private `allowedOnce` check, which answers
  `ask` once for an allowed call.
- `runtime/hooks/capability-gate.mjs`: writes the gate's `ask` as a PreToolUse `ask`
  (`preToolUseAsk`).
- `runtime/claude-plugin/mod/`: the HUD side; `recordOverride` in `register.tsx` runs the verb with the
  literal argv `['paqad-ai', 'rules', 'override', ...args]`, each value its own item, never a shell
  string.

## Data Model

The stop record, `.paqad/session/hud/<session>.last-block.json`:

| Field | Meaning |
| --- | --- |
| `rule`, `title` | the rule id and title |
| `file` | the file the edit targeted |
| `tool_use_id` | the stopped tool call |
| `managed` | true when the gate ran with `PAQAD_MANAGED=1` |
| `sole` | true only when rule scripts were the one capability that blocked this call |
| `at` | when |
| `diff` | a short diff of the edit, at most 2048 bytes |
| `token` | 32 hex characters, fresh per stop |
| `used` | set once an override spends the token |
| `allowed_once` | set with `used` by a successful override; the gate sets it back to `false` when it answers `ask`. A record written before this field existed reads as `false` |
| `session` | the session id |

`rule-overrides.jsonl` holds two kinds of row, each stamped with the bundle envelope:

- the override: `{ kind: "rule-override", rule, file, tool_use_id, by: "human", reason?, at,
  session }`, which records only the person's choice;
- the outcome: `{ kind: "rule-override-outcome", rule, file, tool_use_id, outcome, at, session }`,
  where `outcome` is `landed`, `refused` or `still-blocked`. At most one follows each override
  line. `readRuleOverrides` (the receipt and the HUD snapshot) reads only override rows.

## Behaviour

`applyRuleOverride` checks in this order and stops at the first failure:

1. a session id is given;
2. the file is inside the project;
3. a stop is recorded for that session;
4. the stop is not managed, and no managed-settings file
   (`managed-settings.json` or any `managed-settings.d/*.json` in the platform folder) holds a
   hook command containing `paqad-ai hook --managed`;
5. the stop is `sole`;
6. rule and file match the stop, and the tool call does when `--tool-use-id` is given;
7. the token is unused and equal, compared in constant time;
8. there is an active change.

Then it writes the record with `used: true` and `allowed_once: true` (`markRuleStopAllowedOnce`)
and appends the row. The mark lets nothing through on its own: the gate reads it only on the same
tool call, which the HUD then runs again.

`recordEditOutcome` (`--outcome`) refuses with no session, an outcome other than `landed`,
`refused` or `still-blocked`, no `--tool-use-id`, a file outside the project or no active
change. It writes only when the change already holds an override row for that `tool_use_id`,
rule and file and no outcome row for that `tool_use_id`, so it writes once per call.

## When the HUD offers Allow once

The mod sees a denied call as a `tool.call` result with `deny` set or `isError: true`. A
PreToolUse deny reaches it as `{ result: "Error: <reason>", isError: true }` with no `deny` field,
and that result does not say which hook denied. It offers the three options only when all of
these hold, and otherwise returns the denied result and asks nothing:

1. a fresh stop record exists for this session and this `tool_use_id`, unused. Only paqad's gate
   writes one, and only when it denied this call, so an ordinary failed edit is never retried;
2. the stop is not managed (a managed stop shows the organization toast instead);
3. the stop is `sole`, so no other capability on the same gate (for example the stage gate or
   the rules-loaded gate) blocked the call and the caller's entry state was fresh;
4. `.paqad/decisions/pending/` holds no packet, so the decision-pause gate is not denying;
5. the session's entry sentinel `.paqad/.agent-entry-loaded.d/<session>` exists. This is a
   second check for the main session only. The entry gate keys a subagent call on that
   subagent's own marker `.paqad/session/agent-entry/<agent id>`, which the mod cannot see, so
   for a subagent the entry gate is covered by item 3, not by this check.

The capability gate writes `sole: true` only when the rule-scripts outcome is the one blocking
outcome on that call and the calling agent's entry state is fresh, read with the entry gate's
own `sentinelState` check: the session sentinel for the main session, the per-agent marker for
a subagent. A subagent that never loaded the framework therefore gets a `sole: false` stop and
no Allow once, even when the main session's sentinel exists. If that check throws, the stop is
written `sole: false` and the gate's exit code and message stay the same. The CLI refuses a stop
that is not `sole` as well.

### Record, then retry

The mod never answers a permission check. Its one `tool.check` hook reads Claude Code's answer
for the band and returns it unchanged. Allow once lives in a `tool.call` hook on Edit, Write and
NotebookEdit, registered after the unmatched `tool.call` hook so that one stays outermost:

1. It awaits the call. A result that is not denied comes back as it came.
2. For a denied result it calls `allowRuleStopOnce($, tool_use_id)`, which asks the rule stop
   question and runs the override. It returns `null` on every failure (a question that rejects,
   a file read that fails, an override that exits non-zero, cannot start or times out after
   15 seconds), and `null` returns the first denied result. A failed override shows a toast and
   writes its stderr to the HUD debug log.
3. It reads the stop record again. Without `allowed_once: true` for this call, the `paqad-ai` on
   PATH is older than the HUD: it shows a toast saying Allow once could not take effect and that
   `paqad-ai` should be updated, and returns the deny with no retry.
4. It runs the same call once more (a second `next(e)`, never a third). The engine raises
   PreToolUse again with the same `tool_use_id`, and paqad's gate answers `ask` (below).
5. It runs `paqad-ai rules override --outcome <landed|refused|still-blocked>` and returns the
   retry's result unchanged: `landed` when the retry is not denied, `refused` when the
   `tool.check` hook saw Claude Code answer `ask` for that `tool_use_id` during the retry and the
   result is still denied, and `still-blocked` otherwise. A failed outcome run is logged and
   never changes the result.

The hook's `.catch` is `($, e, next) => next(e)`, so a failure after the first call replays that
settled result, and a failure before it runs the call once, as without the mod.

### What the gate answers on the retry

On the pre-mutation seam, before it writes a fresh stop record, `runCapabilityGate` runs
`allowedOnce`. It passes only when the session id is present, paqad managed mode is off, the hook
runs as Claude Code's (no adapter, or `claude-code`), exactly one capability blocked the call with
exactly one violation, and `takeAllowedOnce` finds `allowed_once: true` for the same
`tool_use_id`, rule and project-relative file. A rule and file match without the same
`tool_use_id` never passes. `takeAllowedOnce` rewrites the record with `allowed_once: false` and
the same token, so the mark is consumed on the first matching read and the same call run again is
blocked. When it passes, the gate writes no stop record and no fresh token, appends one
`hooks.log` line naming the rule, the file and the `tool_use_id`, and returns
`{ block: false, ask: ALLOW_ONCE_REASON, summary: '', narration, context }`, where
`ALLOW_ONCE_REASON` is "You allowed this edit once in the paqad HUD, and paqad recorded the
override. Approve to run it." Any throw inside the check keeps the block.

`capability-gate.mjs` writes that as its one stdout line,
`{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask",
permissionDecisionReason, additionalContext? } }`, and exits 0, only on the pre-mutation seam with
no adapter argument (the Claude Code route). Any other seam or adapter, and any error on that path,
exits 2 and the edit stays blocked.

A mark left behind when the retry never reached the gate names one `tool_use_id` that no later
call can carry, and the next stop record for a new call overwrites it. On the retry Claude Code
merges every PreToolUse answer, so a deny from another tool's hook or a settings rule still wins
over the gate's `ask`: the gate consumes the mark, the call stays blocked and the outcome reads
`still-blocked`.

### Two meanings of managed

- **paqad managed mode** is `PAQAD_MANAGED`, read by `isManagedEnv`, or a Claude Code
  managed-settings file that carries `paqad-ai hook --managed`. The organization enforces paqad's
  rules, and Allow once is never offered or honoured.
- **Claude Code managed settings**, or a Team or Enterprise login, is the setup where Claude
  Code's guard reverts a mod's looser permission answer. The mod gives no such answer, so Allow
  once works there, and nothing on the allow-once path reads it.

### Claude Code permission modes

What happens to the gate's `ask` depends on the mode, per Claude Code's permissions,
permission-modes and hooks docs:

- **Manual (`default`):** the dialog appears.
- **`auto`:** the `ask` forces the dialog. The classifier can deny the call but cannot approve it
  silently.
- **`dontAsk`:** the call is denied, so the edit stays blocked (`refused`).
- **`-p` and Agent SDK runs:** the call is denied unless a permission-prompt tool or
  `canUseTool` callback decides.
- **`plan`:** the edit is blocked.
- **`bypassPermissions`:** prompts are skipped and a hook's `ask` is not on the list no mode
  auto-approves, so the edit runs with no dialog and the HUD choice is the only confirmation
  (`landed`).
- **`acceptEdits`:** the docs only say a hook can force a prompt; the owner's manual check
  records whether the dialog appears.

An edit approved in the dialog that then fails as a tool, for example because `old_string` was
not found, comes back as an error after an `ask` and is recorded as `refused`, because it did
not land.

### Forged override rows

The token sits in plain text in the stop record, so the agent can run `paqad-ai rules override`
itself and write a row marked `by: "human"`. That also marks the stop `allowed_once`, which the
gate does read, but only on a retry of the same `tool_use_id` with the same rule and file. Claude
Code gives every new call a new `tool_use_id` and only the HUD runs the stopped call again, so the
forged row still cannot let an edit through; it only misattributes the evidence. Tracked as tech
debt TD-01M5CW8WGAFVSRZ3AHEKD9VMS8.
