# Constitution

Non-negotiable rules that apply to every change, regardless of stack.

- Before changing an area, read its module and feature docs under `docs/`; reflect any behavior change back into those docs in the same change.
- Change only what the request requires. Do not refactor, reformat, or rename unrelated code in the same change.
- Preserve user-authored files and content. Do not overwrite or delete them without explicit instruction.
- Pair every behavior change with tests, and run them before treating the work as done.
- When a requirement is ambiguous, or an action is risky or hard to reverse, stop and ask instead of guessing.
