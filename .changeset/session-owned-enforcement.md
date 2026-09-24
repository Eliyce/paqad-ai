---
'paqad-ai': patch
---

Two paqad sessions in the same checkout no longer trip over each other. The end-of-turn check and its rule-scripts now run only in the session that made the change, so a question asked in a second window is never blocked by another window's work. Each session also gets its own entry sentinel and its own route pointer, and a prompt that is not feature development no longer receives the rule text meant for someone else's change.
