---
'paqad-ai': minor
---

A decision pause now suggests an earlier answer that a person approves in one click, and every outcome is logged.

- `paqad-ai decision resolve` now keeps `.paqad/decisions/index.json` up to date, and answers given before this release are added on the next lookup. A damaged index rebuilds from `.paqad/decisions/resolved/`. Automated callers behave as they did: answers written by `paqad-ai decision create` are never reused without a pause.
- When a question opens, a script looks for earlier questions with similar wording. On a match, `decision create` prints the candidates and the method for judging them, and `decision resolve` refuses until `paqad-ai decision check` and `paqad-ai decision suggest` have run. The Approvals screen is exempt, because a person answers there directly.
- The question then shows the earlier answer first, as `Same as last time: <label> (from D-...)`, followed by the other options and, when it fits within four choices, `Always use this answer for this kind of question`.
- `paqad-ai decision resolve <id> <key> --always` adds a standing answer to the tracked `.paqad/decisions/standing-answers.json`. It applies to the whole team once merged and lasts until `paqad-ai decision standing remove <id>`. `--ask-anyway` on `decision create` asks this one time. Nine sensitive kinds of question can never have one, and a stage agent cannot set or remove one. Only a standing answer skips a decision pause; spec questions answered from a close precedent still auto-answer as before, and are now logged.
- The `paqad.decision-reuse` ledger records each suggestion, standing answer and auto-answer, and the receipt gains a line such as `decisions: 3 earlier answers suggested, 2 accepted, 1 changed; 1 standing answer used`.
- The `decision` skill now covers the whole flow and can be called on Claude Code.
