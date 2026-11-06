---
'paqad-ai': minor
---

A decision pause can now suggest an earlier answer that a person approves in one click, and every outcome is logged.

- When an agent opens a question with `paqad-ai decision create`, it sees the titles of the earlier questions, whatever their wording, because agents word questions themselves. It reads up to 5 with `paqad-ai decision check <id> --read <D-id> ...` and judges whether an earlier answer still fits. It must record its finding with `paqad-ai decision suggest` before `decision resolve` will run. The Approvals screen is exempt, because a person answers there directly.
- The title list stays under 24,000 characters and 200 rows, newest first, and `older_omitted` says how many older answers were left out. Only listed answers can be read or suggested. The list of offered ids is removed when the question resolves.
- Questions opened by automated callers keep their word match, so one with no match opens as before. `.paqad/decisions/index.json` also works as before.
- The suggested answer comes first, as `Same as last time: <label> (from D-...)`, then the other options and, when it fits within four choices, `Always use this answer for this kind of question`. A question from an automated caller takes only its listed options, so `--other` is refused there, and a fifth option is listed under `not_shown` with its command.
- `paqad-ai decision resolve <id> <key> --always` keeps a standing answer in the tracked `.paqad/decisions/standing-answers.json`. Commit that file with the resolved question. The answer applies to the whole team once merged and lasts until `paqad-ai decision standing remove <id>`. `--ask-anyway` on `decision create` asks this one time. Nine sensitive kinds of question can never have a standing answer, and a stage agent cannot set or remove one.
- Nothing is answered for you when a decision pause opens, except by a standing answer a person chose. Older reuse that runs before a pause is unchanged, including spec questions answered from a close precedent, which are now logged.
- The `paqad.decision-reuse` ledger records each suggestion, standing answer and auto-answer, and the receipt can show a line such as `decisions: 3 earlier answers suggested, 2 accepted, 1 changed; 1 standing answer used`.
- The `decision` skill now covers the whole flow.
