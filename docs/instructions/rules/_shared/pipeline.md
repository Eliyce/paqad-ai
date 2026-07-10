# Pipeline

- Treat a change as deliverable only when format, tests, and build all pass locally. <!-- @rule RL-363b -->
- Stop and fix on the first failing gate; do not stack new work on a broken base. <!-- @rule RL-0642 -->
- Keep each commit scoped to one coherent step so it can be reviewed and reverted on its own. <!-- @rule RL-50fa -->
