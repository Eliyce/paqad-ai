# Rule Stop and Allow Once: Business View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `rule-override`

## Overview

When a rule script stops an edit, the person at the keyboard sometimes knows better: the rule
does not fit this one case. Before, the only answer was to have the agent work around the rule.
Now paqad records the stop, the HUD shows it, and the person can answer it once: **Let Claude fix
it** (the default) or **Allow once, recorded**. Allowing once lets that one edit through and
writes who allowed it, for which rule and file, and why, into the change's evidence, where the
receipt shows it. A stop that the organization's managed settings enforce is never offered.

The technical contract lives at [`technical.md`](./technical.md) and the command surface at
[`api.md`](./api.md).

## User Roles

- **Developer**: answers a rule stop in the HUD; is the only one who can allow an edit past it.
- **Agent**: cannot allow anything by itself. The one-time token comes from the stop the person
  answers.
- **Organization admin**: a rule enforced through managed settings cannot be allowed past by
  anyone on the machine.

## User Flows

1. A rule script denies an edit. The capability gate records the stop for the session: the rule,
   the file, the tool call, a short diff and a one-time token.
2. The HUD offers an answer only when the rule stop is the one thing denying the edit: no other
   paqad gate blocked the call, no decision is waiting, the session loaded the framework and no
   permission rule in settings denied it. Otherwise the plain deny stays and nothing is offered.
   When it does offer, it shows the stop with "Let Claude fix it" selected. "Allow once, recorded" is never the
   first or preselected choice, and it asks for a reason.
3. On Allow once, the HUD runs `paqad-ai rules override` with the token. On success that one call
   goes through; the next identical call is stopped again.
4. The receipt lists every override of the change.

## Business Rules

- One token, one edit. A used, wrong or missing token is refused.
- The override must match the last stop: same rule, same file, and the same tool call when one is
  given.
- A managed stop is refused twice over: when the stop record says managed, and when the machine's
  managed settings carry a `paqad-ai hook --managed` entry, so editing the record cannot unlock
  it. The HUD shows "This rule is enforced by your organization's settings." and no options.
- Hosts with no HUD mod (Codex, Gemini, plugin-less Claude Code) keep the plain stop with no way
  past it.

## Triggers and Side Effects

- The gate writes `.paqad/session/hud/<session>.last-block.json`; the snapshot carries it as
  `last_block`.
- An accepted override marks the token used and appends a row to the change's
  `rule-overrides.jsonl`.

## Error States

- No session, no recorded stop, a different rule, file or call, a bad token, a managed stop or no
  active change: refused with the reason, exit 1, nothing recorded.
