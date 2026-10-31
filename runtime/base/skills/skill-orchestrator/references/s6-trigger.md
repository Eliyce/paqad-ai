# S6 trigger

verified: 2026-10-31

1. Write about twenty queries as `[{query, should_trigger}]`: eight to ten that should fire the skill, in varied wording, and eight to ten near misses that should not.
2. Run `paqad-ai skill trigger plan <name> queries.json`. It splits them sixty to forty into train and validation with seed 42.
3. Run each query three times per description. Revise the description from train failures only, for at most five iterations.
4. Record every iteration with `paqad-ai skill trigger record <name> results.json`, shaped `{iterations: [{description, results: [{id, run, fired}]}], cost_usd}`.

The best validation score wins and its description is written into the draft. A description over 1024 characters is discarded. The final description is checked again for overlap with the installed skills.
