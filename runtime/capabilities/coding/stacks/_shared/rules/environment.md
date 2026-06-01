# Environment

- Resolve configuration through a single typed and validated layer, not scattered raw environment reads across the code.
- Fail fast at startup when a required variable is missing, with a message naming what's absent.
- Commit a `.env.example` documenting every variable; never commit real secrets.
- Default to safe local-development values, never production values.
