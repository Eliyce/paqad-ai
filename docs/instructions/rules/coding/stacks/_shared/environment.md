# Environment

- Resolve configuration through a single typed and validated layer, not scattered raw environment reads across the code. <!-- @rule RL-7268 -->
- Fail fast at startup when a required variable is missing, with a message naming what's absent. <!-- @rule RL-12e4 -->
- Commit a `.env.example` documenting every variable; never commit real secrets. <!-- @rule RL-54f2 -->
- Default to safe local-development values, never production values. <!-- @rule RL-549b -->
