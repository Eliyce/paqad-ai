# Pipeline

- Treat a change as deliverable only when format, tests, and build all pass locally.
- Stop and fix on the first failing gate; do not stack new work on a broken base.
- Keep each commit scoped to one coherent step so it can be reviewed and reverted on its own.
