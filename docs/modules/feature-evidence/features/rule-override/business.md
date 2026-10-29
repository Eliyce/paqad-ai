# Rule Stop and Allow Once: Business View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `rule-override`

## Overview

When a rule script stops an edit, the person at the keyboard sometimes knows better: the rule
does not fit this one case. Before, the only answer was to have the agent work around the rule.
Now paqad records the stop, the HUD shows it, and the person can answer it once: **Let Claude fix
it** (the default) or **Allow once, recorded**. Allowing once writes who allowed it, for which
rule and file, and why, into the change's evidence, where the receipt shows it, and then runs the
same edit again. paqad's own gate asks Claude Code to show its permission dialog for that one
edit, and the person approves it there. A second line then records whether the edit landed. The
HUD never approves an edit and never changes a permission answer, so Allow once works on every
Claude Code plan, including Team and Enterprise logins and machines with Claude Code managed
settings. A stop enforced through paqad managed mode is never offered.

The technical contract lives at [`technical.md`](./technical.md) and the command surface at
[`api.md`](./api.md).

## User Roles

- **Developer**: answers a rule stop in the HUD; is the only one who can allow an edit past it.
- **Agent**: cannot let an edit through. The override row is meant to be written through the
  HUD's Allow once, and only the HUD runs the stopped call again so the gate can ask. The token
  stops a replay, not an agent caller: the agent can read it and run `paqad-ai rules override`
  itself, which writes a row marked as a person's and marks the stop allowed once. The gate only
  honours that mark on a retry of the same tool call, which only the HUD makes, so the forged row
  cannot let an edit through. This known limit is tracked as tech debt
  TD-01M5CW8WGAFVSRZ3AHEKD9VMS8.
- **Organization admin**: a rule enforced through paqad managed mode cannot be allowed past by
  anyone on the machine.
- **Claude Code**: its own permission dialog has the last word on the allowed edit, and its
  permission mode decides whether that dialog appears.

## User Flows

1. A rule script denies an edit. The capability gate records the stop for the session: the rule,
   the file, the tool call, a short diff and a one-time token.
2. The HUD offers an answer only when the rule stop is the one thing denying the edit: no other
   paqad gate blocked the call, no decision is waiting, the session loaded the framework and no
   permission rule in settings denied it. Otherwise the plain deny stays and nothing is offered.
   When it does offer, it shows the stop with "Let Claude fix it" selected. "Allow once, recorded" is never the
   first or preselected choice, and it asks for a reason.
3. On Allow once, the HUD runs `paqad-ai rules override` with the token. On success the stop is
   marked allowed once, and the HUD runs the same call again.
4. On that retry paqad's gate answers `ask` once for that exact call, and Claude Code shows its
   own permission dialog. The person approves or refuses there. The next identical call is
   stopped again.
5. The HUD records the outcome: landed, or still blocked (the edit did not go through, whether the
   person refused the dialog or something else kept it denied).
6. The receipt lists every override of the change.

## Business Rules

- One token, one edit. A used, wrong or missing token is refused.
- The override must match the last stop: same rule, same file, and the same tool call when one is
  given.
- A managed stop is refused twice over: when the stop record says managed, and when the machine's
  managed settings carry a `paqad-ai hook --managed` entry, so editing the record cannot unlock
  it. The HUD shows "This rule is enforced by your organization's settings." and no options.
- Allow once lets at most one call reach Claude Code's dialog, and only the exact tool call the
  person allowed, never a later edit to the same file under the same rule.
- A deny from the person's settings rules, another tool's hook, paqad managed mode or a second
  paqad gate still blocks the retried edit. Any failure on the way leaves the edit blocked.
- If the `paqad-ai` on PATH is older than the HUD and does not mark the stop, the HUD says so in a
  toast, keeps the deny and retries nothing.
- Hosts with no HUD mod (Codex, Gemini, plugin-less Claude Code) keep the plain stop with no way
  past it.

## Triggers and Side Effects

- The gate writes `.paqad/session/hud/<session>.last-block.json`; the snapshot carries it as
  `last_block`.
- An accepted override marks the token used and the stop allowed once, and appends a row to the
  change's `rule-overrides.jsonl`. After the retry, a second row records the outcome.

## Error States

- No session, no recorded stop, a different rule, file or call, a bad token, a managed stop or no
  active change: refused with the reason, exit 1, nothing recorded.
