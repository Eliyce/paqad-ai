---
'paqad-ai': minor
---

Teams can now ask for a short design sign-off before the build starts, posted where the team already works.

- A new team file, `.paqad/configs/git-workflow/design-sign-off.yaml`, turns it on. It is off by default, so nothing changes until a team opts in, and `paqad-ai update` adds the file with its defaults.
- After the spec is frozen on a listed lane, paqad asks for a high-level design in plain business language. The new `high-level-design` skill writes it and `paqad-ai hld check` checks its length, its sections, and that it has no code words, jargon or em dashes.
- The agent posts it with the tools it already has in the chat, with no setup in paqad. The tracker comes from the ticket the developer pasted (a Jira, GitHub, Linear or ServiceNow link), and otherwise from `tickets.yaml`. The approval channel can differ from the tracker, for example Jira for tickets and MS Teams or Slack for sign-off, and it is the tracker when the team names none. Guides cover Jira, MS Teams, Slack and GitHub.
- With `wait_for_approval` on, the first code edit waits for sign-off. `paqad-ai hld check-approval` reads the replies: a teammate's approval or the approved ticket status opens the gate, a clear request for changes sends the spec back, and anything else keeps it waiting. The developer's own replies, bots, negated approvals and replies from before the latest version never count.
- `paqad-ai hld skip --reason` builds before sign-off when the team allows it, and the skip is posted back to the team. When the destination isn't connected, the design is shown in chat and the change carries on.
- A new chat lists the designs still waiting, and a prompt naming a waiting ticket picks that change up again. The pull request body and the receipt say whether the design was signed off.
