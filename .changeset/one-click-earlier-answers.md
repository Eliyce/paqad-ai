---
'paqad-ai': minor
---

A decision pause now suggests an earlier answer that a person approves in one click, and every outcome is logged. `.paqad/decisions/index.json` and automated callers behave as they did.

- When an agent opens a question with `paqad-ai decision create` and any earlier answer is eligible, the output lists the earlier question titles and the method for judging them, whatever the wording, because agents word questions themselves. The skill scans the titles, reads up to 5 with `paqad-ai decision check <id> --read <D-id> ...`, and judges meaning. `decision resolve` refuses until `paqad-ai decision suggest` has run. The Approvals screen is exempt, because a person answers there directly.
- That list stays under 24,000 characters and 200 rows, newest first, and `older_omitted` says how many older answers were left out. Only printed rows can be read or suggested. When the question resolves, the list of offered ids is removed from its resolved file.
- Automated callers keep their word match at 0.5 and their current output, so a question with no match opens as before.
- The question then shows the earlier answer first, as `Same as last time: <label> (from D-...)`, followed by the other options and, when it fits within four choices, `Always use this answer for this kind of question`. A question opened by an automated caller takes only its listed options, so `--other` is refused there, and a fifth option is listed under `not_shown` with its command.
- `paqad-ai decision resolve <id> <key> --always` adds a standing answer to the tracked `.paqad/decisions/standing-answers.json`, the only file to commit beyond the resolved packet. It applies to the whole team once merged and lasts until `paqad-ai decision standing remove <id>`. `--ask-anyway` on `decision create` asks this one time, with the same check. Nine sensitive kinds of question can never have one, and a stage agent cannot set or remove one. Only a standing answer skips a decision pause; spec questions answered from a close precedent still auto-answer as before, and are now logged.
- The `paqad.decision-reuse` ledger records each suggestion, standing answer and auto-answer, and the receipt gains a line such as `decisions: 3 earlier answers suggested, 2 accepted, 1 changed; 1 standing answer used`.
- The `decision` skill now covers the whole flow.
