# Constitution

Non-negotiable rules that apply to every change, regardless of stack.

- Before changing an area, read its module and feature docs under `docs/`; reflect any behavior change back into those docs in the same change. <!-- @rule RL-787a -->
- Change only what the request requires. Do not refactor, reformat, or rename unrelated code in the same change. <!-- @rule RL-b228 -->
- Preserve user-authored files and content. Do not overwrite or delete them without explicit instruction. <!-- @rule RL-7017 -->
- Pair every behavior change with tests, and run them before treating the work as done. <!-- @rule RL-3d12 -->
- When a requirement is ambiguous, or an action is risky or hard to reverse, stop and ask instead of guessing. <!-- @rule RL-6352 -->
