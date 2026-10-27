# CI/CD

- CI must run the same format, lint, test, and build gates that block local delivery. <!-- @rule RL-c5f0 -->
- Keep the pipeline green; do not merge on red. <!-- @rule RL-c17c -->
- Commit the lockfile and pin tool versions so CI and local environments resolve the same dependencies. <!-- @rule RL-3d8c -->
- Fail the build on high or critical dependency advisories. <!-- @rule RL-a9d3 -->
